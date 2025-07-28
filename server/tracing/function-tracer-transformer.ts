import * as ts from 'typescript'
import { createSafeJsonStringifyCall } from './safe-json-serializer.js'
import { isExpressRouteCall, extractRoutePath, instrumentExpressRoute } from './express-instrumenter.js'

interface TransformerOptions {
    loggerName?: string
    enabled?: boolean
}

export function createFunctionTracerTransformer(options: TransformerOptions = {}) {
    const { loggerName = 'console.log', enabled = true } = options

    if (!enabled) {
        return (context: ts.TransformationContext) => (sourceFile: ts.SourceFile) => sourceFile
    }

    // Helper function to check if a function is async
    function isAsyncFunction(node: ts.FunctionLikeDeclaration): boolean {
        return !!(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword))
    }



    return (context: ts.TransformationContext) => {
        return (sourceFile: ts.SourceFile) => {
            const fileName = sourceFile.fileName.split('/').pop() || sourceFile.fileName
            let scopeStack: string[] = []
            let anonymousCounter = 0

            const visitor = (node: ts.Node): ts.Node => {
                // Detect and instrument Express route calls
                if (ts.isCallExpression(node) && isExpressRouteCall(node)) {
                    const methodName = ts.isIdentifier((node.expression as ts.PropertyAccessExpression).name)
                        ? (node.expression as ts.PropertyAccessExpression).name.text : null
                    const path = extractRoutePath(node)
                    return instrumentExpressRoute(node, methodName!.toUpperCase(), path, fileName, context, createInstrumentedBody, isAsyncFunction)
                }

                // Track scope for classes
                if (ts.isClassDeclaration(node) && node.name) {
                    scopeStack.push(node.name.text)
                    const result = ts.visitEachChild(node, visitor, context)
                    scopeStack.pop()
                    return result
                }

                // Track scope for variable declarations with object literals
                if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
                    node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
                    scopeStack.push(node.name.text)
                    const result = ts.visitEachChild(node, visitor, context)
                    scopeStack.pop()
                    return result
                }

                // Track scope for property assignments with object literals
                if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) &&
                    ts.isObjectLiteralExpression(node.initializer)) {
                    scopeStack.push(node.name.text)
                    const result = ts.visitEachChild(node, visitor, context)
                    scopeStack.pop()
                    return result
                }

                const currentScope = scopeStack.join('.')

                // Universal function instrumentation
                if (ts.isFunctionDeclaration(node)) {
                    const name = node.name?.text || (++anonymousCounter).toString()
                    return instrumentFunction(node, name, fileName, currentScope, context)
                }

                if (ts.isArrowFunction(node)) {
                    const name = getFunctionName(node) || (++anonymousCounter).toString()
                    return instrumentArrowFunction(node, name, fileName, currentScope, context)
                }

                if (ts.isMethodDeclaration(node)) {
                    const name = ts.isIdentifier(node.name) ? node.name.text : (++anonymousCounter).toString()
                    return instrumentMethod(node, name, fileName, currentScope, context)
                }

                if (ts.isFunctionExpression(node)) {
                    const name = node.name?.text || getFunctionName(node) || (++anonymousCounter).toString()
                    return instrumentFunctionExpression(node, name, fileName, currentScope, context)
                }

                return ts.visitEachChild(node, visitor, context)
            }

            // Try to extract function name from context (e.g., const myFunc = () => {})
            function getFunctionName(node: ts.ArrowFunction | ts.FunctionExpression): string | null {
                const parent = node.parent
                if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
                    return parent.name.text
                }
                if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
                    return parent.name.text
                }
                return null
            }

            return ts.visitNode(sourceFile, visitor) as ts.SourceFile
        }
    }



    function instrumentFunction(
        node: ts.FunctionDeclaration,
        functionName: string,
        fileName: string,
        scope: string,
        context: ts.TransformationContext
    ): ts.FunctionDeclaration {
        if (!node.body) return node

        const instrumentedBody = createInstrumentedBody(
            node.body,
            functionName,
            fileName,
            node.parameters,
            isAsyncFunction(node),
            scope,
            context
        )

        return ts.factory.updateFunctionDeclaration(
            node,
            node.modifiers,
            node.asteriskToken,
            node.name,
            node.typeParameters,
            node.parameters,
            node.type,
            instrumentedBody
        )
    }

    function instrumentArrowFunction(
        node: ts.ArrowFunction,
        functionName: string,
        fileName: string,
        scope: string,
        context: ts.TransformationContext
    ): ts.ArrowFunction {
        let body: ts.ConciseBody

        if (ts.isBlock(node.body)) {
            body = createInstrumentedBody(
                node.body,
                functionName,
                fileName,
                node.parameters,
                isAsyncFunction(node),
                scope,
                context
            )
        } else {
            // Expression body - convert to block and instrument
            const returnStatement = ts.factory.createReturnStatement(node.body)
            const blockBody = ts.factory.createBlock([returnStatement], true)
            body = createInstrumentedBody(
                blockBody,
                functionName,
                fileName,
                node.parameters,
                isAsyncFunction(node),
                scope,
                context
            )
        }

        return ts.factory.updateArrowFunction(
            node,
            node.modifiers,
            node.typeParameters,
            node.parameters,
            node.type,
            node.equalsGreaterThanToken,
            body
        )
    }

    function instrumentMethod(
        node: ts.MethodDeclaration,
        methodName: string,
        fileName: string,
        scope: string,
        context: ts.TransformationContext
    ): ts.MethodDeclaration {
        if (!node.body) return node

        const instrumentedBody = createInstrumentedBody(
            node.body,
            methodName,
            fileName,
            node.parameters,
            isAsyncFunction(node),
            scope,
            context
        )

        return ts.factory.updateMethodDeclaration(
            node,
            node.modifiers,
            node.asteriskToken,
            node.name,
            node.questionToken,
            node.typeParameters,
            node.parameters,
            node.type,
            instrumentedBody
        )
    }

    function instrumentFunctionExpression(
        node: ts.FunctionExpression,
        functionName: string,
        fileName: string,
        scope: string,
        context: ts.TransformationContext
    ): ts.FunctionExpression {
        if (!node.body) return node

        const instrumentedBody = createInstrumentedBody(
            node.body,
            functionName,
            fileName,
            node.parameters,
            isAsyncFunction(node),
            scope,
            context
        )

        return ts.factory.updateFunctionExpression(
            node,
            node.modifiers,
            node.asteriskToken,
            node.name,
            node.typeParameters,
            node.parameters,
            node.type,
            instrumentedBody
        )
    }

    function createInstrumentedBody(
        originalBody: ts.Block,
        functionName: string,
        fileName: string,
        parameters: ts.NodeArray<ts.ParameterDeclaration>,
        isAsync: boolean,
        scope: string,
        context: ts.TransformationContext
    ): ts.Block {
        const paramNames = parameters.map(p =>
            ts.isIdentifier(p.name) ? p.name.text : 'param'
        )

        // Entry log
        const entryLog = createLogStatement(
            'ENTER',
            functionName,
            fileName,
            paramNames.map(name => ts.factory.createIdentifier(name)),
            scope
        )

        // Transform return statements to log before returning
        // Only instrument top-level returns, not those in nested functions
        let functionDepth = 0;
        const transformer = (node: ts.Node): ts.Node => {
            // Track when we enter/exit nested functions
            if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
                ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
                functionDepth++
                const result = ts.visitEachChild(node, transformer, context)
                functionDepth--
                return result
            }

            // Only instrument return statements at the top level (functionDepth === 0)
            if (ts.isReturnStatement(node) && functionDepth === 0) {
                const exitLog = node.expression
                    ? createLogStatement('EXIT', functionName, fileName, [sanitizeExpression(node.expression)], scope)
                    : createLogStatement('EXIT', functionName, fileName, [], scope)

                return ts.factory.createBlock([exitLog, node], false)
            }
            return ts.visitEachChild(node, transformer, context)
        }

        const transformedStatements = originalBody.statements.map(stmt =>
            ts.visitNode(stmt, transformer) as ts.Statement
        )

        // Helper function to check if a statement contains return statements
        function containsReturnStatement(node: ts.Node): boolean {
            let depth = 0;

            function checkNode(n: ts.Node): boolean {
                // Track when we enter/exit nested functions
                if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) ||
                    ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) {
                    depth++
                    const result = ts.forEachChild(n, checkNode) || false
                    depth--
                    return result
                }

                // Only count return statements at the top level
                if (ts.isReturnStatement(n) && depth === 0) {
                    return true
                }
                return ts.forEachChild(n, checkNode) || false
            }

            return checkNode(node)
        }

        // Check if the last statement is a return statement
        function lastStatementIsReturn(statements: readonly ts.Statement[]): boolean {
            if (statements.length === 0) return false
            const lastStatement = statements[statements.length - 1]
            return ts.isReturnStatement(lastStatement)
        }

        // Always add exit log at the end unless the last statement is already a return
        const needsExitLog = !lastStatementIsReturn(originalBody.statements)
        const finalStatements = needsExitLog
            ? [...transformedStatements, createLogStatement('EXIT', functionName, fileName, [], scope)]
            : transformedStatements

        // Wrap in try-catch for error logging
        const tryBlock = ts.factory.createBlock([entryLog, ...finalStatements], true)

        const catchClause = ts.factory.createCatchClause(
            ts.factory.createVariableDeclaration('error'),
            ts.factory.createBlock([
                createLogStatement('ERROR', functionName, fileName, [
                    ts.factory.createObjectLiteralExpression([
                        ts.factory.createPropertyAssignment('message',
                            ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('error'), 'message')
                        ),
                        ts.factory.createPropertyAssignment('name',
                            ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('error'), 'name')
                        )
                    ])
                ], scope),
                ts.factory.createThrowStatement(ts.factory.createIdentifier('error'))
            ], true)
        )

        const tryStatement = ts.factory.createTryStatement(tryBlock, catchClause, undefined)

        return ts.factory.createBlock([tryStatement], true)
    }

    function createLogStatement(status: string, functionName: string, fileName: string, args: ts.Expression[] = [], scope: string): ts.ExpressionStatement {
        // Format: STATUS|FUNCTION|file|key|name|[...]
        const argsString = args.length > 0
            ? createSafeJsonStringifyCall(args)
            : ts.factory.createStringLiteral('[]')

        const keyValue = scope || ''
        const logMessage = ts.factory.createTemplateExpression(
            ts.factory.createTemplateHead(`${status}|FUNCTION|${fileName}|${keyValue}|${functionName}|`),
            [ts.factory.createTemplateSpan(argsString, ts.factory.createTemplateTail(''))]
        )

        const logCall = ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(
                ts.factory.createIdentifier('console'),
                'log'
            ),
            undefined,
            [logMessage]
        )

        return ts.factory.createExpressionStatement(logCall)
    }

    function sanitizeExpression(expr: ts.Expression): ts.Expression {
        // Check for await expressions and replace with a placeholder
        if (ts.isAwaitExpression(expr)) {
            return ts.factory.createStringLiteral('[await expression]')
        }

        // Check for function calls that might be async
        if (ts.isCallExpression(expr)) {
            // If it's a function call, we can't easily determine if it's async
            // so we'll keep the call but sanitize its arguments
            const sanitizedArgs = expr.arguments.map(arg => sanitizeExpression(arg))
            return ts.factory.updateCallExpression(
                expr,
                expr.expression,
                expr.typeArguments,
                sanitizedArgs
            )
        }

        return expr
    }
} 