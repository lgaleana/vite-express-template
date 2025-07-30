import * as ts from 'typescript'
import { createSafeToStringFunction } from './safe-json-serializer.js'
import { isExpressRouteCall, extractRoutePath, addSimpleEndpointLogging } from './express-instrumenter.js'

export function createFunctionTracerTransformer() {

    return (context: ts.TransformationContext) => {
        return (sourceFile: ts.SourceFile) => {
            const fileName = sourceFile.fileName.split('/').pop() || sourceFile.fileName
            const wrapperStatements: ts.Statement[] = []

            const visitor = (node: ts.Node): ts.Node => {
                // Handle function declarations
                if (ts.isFunctionDeclaration(node) && node.name) {
                    const functionName = node.name.text
                    const wrapper = createAppropriateWrapper(node, functionName, fileName)
                    wrapperStatements.push(wrapper)
                    return node // Return original function unchanged
                }

                // Handle variable declarations with function expressions/arrows
                if (ts.isVariableDeclaration(node) &&
                    ts.isIdentifier(node.name) &&
                    node.initializer &&
                    (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))) {

                    const functionName = node.name.text
                    const wrapper = createAppropriateWrapper(node.initializer, functionName, fileName)
                    wrapperStatements.push(wrapper)
                    return node // Return original declaration unchanged
                }

                // Handle method declarations in classes/objects
                if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
                    const methodName = node.name.text
                    const wrapper = createAppropriateWrapper(node, methodName, fileName)
                    wrapperStatements.push(wrapper)
                    return node // Return original method unchanged
                }

                // Handle getter/setter declarations
                if ((ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && ts.isIdentifier(node.name)) {
                    const accessorName = node.name.text
                    const prefix = ts.isGetAccessorDeclaration(node) ? 'get_' : 'set_'
                    const wrapper = createAppropriateWrapper(node, `${prefix}${accessorName}`, fileName)
                    wrapperStatements.push(wrapper)
                    return node // Return original accessor unchanged
                }

                // Handle Express routes separately
                if (ts.isCallExpression(node) && isExpressRouteCall(node)) {
                    // For Express routes, we can add endpoint logging without wrapping
                    const methodName = ts.isIdentifier((node.expression as ts.PropertyAccessExpression).name)
                        ? (node.expression as ts.PropertyAccessExpression).name.text : null
                    const path = extractRoutePath(node)

                    // Add simple endpoint logging to route handlers
                    const instrumentedArgs = node.arguments.map(arg => {
                        if (ts.isFunctionExpression(arg) || ts.isArrowFunction(arg)) {
                            return addSimpleEndpointLogging(arg, methodName!.toUpperCase(), path, fileName)
                        }
                        return arg
                    })

                    return ts.factory.updateCallExpression(
                        node,
                        node.expression,
                        node.typeArguments,
                        instrumentedArgs
                    )
                }

                return ts.visitEachChild(node, visitor, context)
            }

            const visitedSourceFile = ts.visitNode(sourceFile, visitor) as ts.SourceFile

            // Add safeToString function and all wrapper statements at the end
            const safeToStringFunction = createSafeToStringFunction()
            const newStatements = [
                safeToStringFunction,
                ...visitedSourceFile.statements,
                ...wrapperStatements
            ]

            return ts.factory.updateSourceFile(
                visitedSourceFile,
                newStatements
            )
        }
    }

    // ====== FUNCTION TYPE DETECTION ======

    function createAppropriateWrapper(
        functionNode: ts.FunctionLikeDeclaration,
        functionName: string,
        fileName: string
    ): ts.Statement {
        const needsAsync = needsAsyncWrapper(functionNode)

        if (needsAsync) {
            return createAsyncWrapper(functionName, fileName)
        } else {
            return createSyncWrapper(functionName, fileName)
        }
    }

    function needsAsyncWrapper(node: ts.FunctionLikeDeclaration): boolean {
        // 1. Has async keyword
        if (hasAsyncModifier(node)) return true;

        // 2. Return type is Promise<T>
        if (hasPromiseReturnType(node)) return true;

        return false; // Use sync wrapper for everything else
    }

    function hasAsyncModifier(node: ts.FunctionLikeDeclaration): boolean {
        return node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.AsyncKeyword) ?? false
    }

    function hasPromiseReturnType(node: ts.FunctionLikeDeclaration): boolean {
        if (!node.type) return false

        // Check for Promise<T> return type
        if (ts.isTypeReferenceNode(node.type) &&
            ts.isIdentifier(node.type.typeName) &&
            node.type.typeName.text === 'Promise') {
            return true
        }

        return false
    }

    // ====== WRAPPER CREATORS ======

    function createSyncWrapper(functionName: string, fileName: string): ts.Statement {
        const originalVarName = `__original_${functionName}`

        const storeOriginal = ts.factory.createVariableStatement(
            undefined,
            ts.factory.createVariableDeclarationList([
                ts.factory.createVariableDeclaration(
                    originalVarName,
                    undefined,
                    undefined,
                    ts.factory.createIdentifier(functionName)
                )
            ], ts.NodeFlags.Const)
        )

        const wrapperFunction = ts.factory.createFunctionExpression(
            undefined,
            undefined,
            undefined,
            undefined,
            [ts.factory.createParameterDeclaration(
                undefined,
                ts.factory.createToken(ts.SyntaxKind.DotDotDotToken),
                'args'
            )],
            undefined,
            ts.factory.createBlock([
                // Entry log
                ts.factory.createExpressionStatement(
                    createSimpleLogCall('ENTER', functionName, fileName,
                        ts.factory.createIdentifier('args'))
                ),

                ts.factory.createTryStatement(
                    ts.factory.createBlock([
                        ts.factory.createVariableStatement(
                            undefined,
                            ts.factory.createVariableDeclarationList([
                                ts.factory.createVariableDeclaration(
                                    'result',
                                    undefined,
                                    undefined,
                                    ts.factory.createCallExpression(
                                        ts.factory.createPropertyAccessExpression(
                                            ts.factory.createIdentifier(originalVarName),
                                            'apply'
                                        ),
                                        undefined,
                                        [
                                            ts.factory.createThis(),
                                            ts.factory.createIdentifier('args')
                                        ]
                                    )
                                )
                            ], ts.NodeFlags.Const)
                        ),

                        // Exit log
                        ts.factory.createExpressionStatement(
                            createSimpleLogCall('EXIT', functionName, fileName,
                                ts.factory.createIdentifier('result'))
                        ),

                        ts.factory.createReturnStatement(
                            ts.factory.createIdentifier('result')
                        )
                    ], true),

                    ts.factory.createCatchClause(
                        ts.factory.createVariableDeclaration('error'),
                        ts.factory.createBlock([
                            ts.factory.createExpressionStatement(
                                createSimpleLogCall('ERROR', functionName, fileName,
                                    ts.factory.createIdentifier('error'))
                            ),

                            ts.factory.createThrowStatement(
                                ts.factory.createIdentifier('error')
                            )
                        ], true)
                    ),

                    undefined
                )
            ], true)
        )

        const replaceWithWrapper = ts.factory.createExpressionStatement(
            ts.factory.createAssignment(
                ts.factory.createIdentifier(functionName),
                wrapperFunction
            )
        )

        return ts.factory.createBlock([storeOriginal, replaceWithWrapper], false)
    }

    function createAsyncWrapper(functionName: string, fileName: string): ts.Statement {
        const originalVarName = `__original_${functionName}`

        const storeOriginal = ts.factory.createVariableStatement(
            undefined,
            ts.factory.createVariableDeclarationList([
                ts.factory.createVariableDeclaration(
                    originalVarName,
                    undefined,
                    undefined,
                    ts.factory.createIdentifier(functionName)
                )
            ], ts.NodeFlags.Const)
        )

        const wrapperFunction = ts.factory.createFunctionExpression(
            [ts.factory.createModifier(ts.SyntaxKind.AsyncKeyword)],
            undefined,
            undefined,
            undefined,
            [ts.factory.createParameterDeclaration(
                undefined,
                ts.factory.createToken(ts.SyntaxKind.DotDotDotToken),
                'args'
            )],
            undefined,
            ts.factory.createBlock([
                // Entry log
                ts.factory.createExpressionStatement(
                    createSimpleLogCall('ENTER', functionName, fileName,
                        ts.factory.createIdentifier('args'))
                ),

                ts.factory.createTryStatement(
                    ts.factory.createBlock([
                        ts.factory.createVariableStatement(
                            undefined,
                            ts.factory.createVariableDeclarationList([
                                ts.factory.createVariableDeclaration(
                                    'result',
                                    undefined,
                                    undefined,
                                    ts.factory.createAwaitExpression(
                                        ts.factory.createCallExpression(
                                            ts.factory.createPropertyAccessExpression(
                                                ts.factory.createIdentifier(originalVarName),
                                                'apply'
                                            ),
                                            undefined,
                                            [
                                                ts.factory.createThis(),
                                                ts.factory.createIdentifier('args')
                                            ]
                                        )
                                    )
                                )
                            ], ts.NodeFlags.Const)
                        ),

                        // Exit log
                        ts.factory.createExpressionStatement(
                            createSimpleLogCall('EXIT', functionName, fileName,
                                ts.factory.createIdentifier('result'))
                        ),

                        ts.factory.createReturnStatement(
                            ts.factory.createIdentifier('result')
                        )
                    ], true),

                    ts.factory.createCatchClause(
                        ts.factory.createVariableDeclaration('error'),
                        ts.factory.createBlock([
                            ts.factory.createExpressionStatement(
                                createSimpleLogCall('ERROR', functionName, fileName,
                                    ts.factory.createIdentifier('error'))
                            ),

                            ts.factory.createThrowStatement(
                                ts.factory.createIdentifier('error')
                            )
                        ], true)
                    ),

                    undefined
                )
            ], true)
        )

        const replaceWithWrapper = ts.factory.createExpressionStatement(
            ts.factory.createAssignment(
                ts.factory.createIdentifier(functionName),
                wrapperFunction
            )
        )

        return ts.factory.createBlock([storeOriginal, replaceWithWrapper], false)
    }

    function createSimpleLogCall(status: string, functionName: string, fileName: string, valueExpression: ts.Expression): ts.CallExpression {
        // Create ultra-simple logging that never fails:
        // console.log(`${status}|FUNCTION|${fileName}||${functionName}|${safeToString(value)}`)

        const logMessage = ts.factory.createTemplateExpression(
            ts.factory.createTemplateHead(`${status}|FUNCTION|${fileName}||${functionName}|`),
            [ts.factory.createTemplateSpan(
                createSafeToStringCall(valueExpression),
                ts.factory.createTemplateTail('')
            )]
        )

        return ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(
                ts.factory.createIdentifier('console'),
                'log'
            ),
            undefined,
            [logMessage]
        )
    }

    function createSafeToStringCall(valueExpression: ts.Expression): ts.Expression {
        // Generate: safeToString(value)
        return ts.factory.createCallExpression(
            ts.factory.createIdentifier('safeToString'),
            undefined,
            [valueExpression]
        )
    }
} 