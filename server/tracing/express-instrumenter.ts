import * as ts from 'typescript'

// Express HTTP methods for endpoint detection
const EXPRESS_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'all'])

/**
 * Checks if a call expression is an Express route definition
 */
export function isExpressRouteCall(node: ts.CallExpression): boolean {
    if (!ts.isPropertyAccessExpression(node.expression)) return false

    const methodName = ts.isIdentifier(node.expression.name) ? node.expression.name.text : null
    const receiver = node.expression.expression

    return !!(methodName && EXPRESS_METHODS.has(methodName) &&
        ts.isIdentifier(receiver) &&
        (receiver.text === 'app' || receiver.text === 'router'))
}

/**
 * Extracts the route path from an Express route call
 */
export function extractRoutePath(node: ts.CallExpression): string {
    const firstArg = node.arguments[0]
    if (ts.isStringLiteral(firstArg)) {
        return firstArg.text
    }
    return '/*'
}

/**
 * Instruments an Express route call to add endpoint logging
 */
export function instrumentExpressRoute(
    node: ts.CallExpression,
    method: string,
    path: string,
    fileName: string,
    context: ts.TransformationContext,
    createInstrumentedBody: (
        originalBody: ts.Block,
        functionName: string,
        fileName: string,
        parameters: ts.NodeArray<ts.ParameterDeclaration>,
        isAsync: boolean,
        scope: string,
        context: ts.TransformationContext
    ) => ts.Block,
    isAsyncFunction: (node: ts.FunctionLikeDeclaration) => boolean
): ts.CallExpression {
    // Instrument any function arguments (route handlers)
    const instrumentedArgs = node.arguments.map((arg, index) => {
        // Check for direct function expressions/arrow functions
        if (ts.isFunctionExpression(arg) || ts.isArrowFunction(arg)) {
            // Add endpoint logging to the function
            return addEndpointLoggingToHandler(arg, method, path, fileName, context, createInstrumentedBody, isAsyncFunction)
        }

        // Check for function references (identifiers) - wrap them with endpoint logging
        if (ts.isIdentifier(arg)) {
            return wrapFunctionReferenceWithLogging(arg, method, path, fileName)
        }

        // Check for type assertions that contain function expressions
        if (ts.isAsExpression(arg)) {
            let innerExpression = arg.expression

            // Handle parenthesized expressions within type assertions
            if (ts.isParenthesizedExpression(innerExpression)) {
                innerExpression = innerExpression.expression
            }

            if (ts.isFunctionExpression(innerExpression) || ts.isArrowFunction(innerExpression)) {
                // Instrument the inner function and preserve the wrapper structure
                const instrumentedFunction = addEndpointLoggingToHandler(
                    innerExpression,
                    method,
                    path,
                    fileName,
                    context,
                    createInstrumentedBody,
                    isAsyncFunction
                )

                // Reconstruct the structure: preserve parentheses if they existed
                const newExpression = ts.isParenthesizedExpression(arg.expression)
                    ? ts.factory.updateParenthesizedExpression(arg.expression, instrumentedFunction)
                    : instrumentedFunction

                return ts.factory.updateAsExpression(arg, newExpression, arg.type)
            }
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

function addEndpointLoggingToHandler(
    handler: ts.FunctionExpression | ts.ArrowFunction,
    method: string,
    path: string,
    fileName: string,
    context: ts.TransformationContext,
    createInstrumentedBody: (
        originalBody: ts.Block,
        functionName: string,
        fileName: string,
        parameters: ts.NodeArray<ts.ParameterDeclaration>,
        isAsync: boolean,
        scope: string,
        context: ts.TransformationContext
    ) => ts.Block,
    isAsyncFunction: (node: ts.FunctionLikeDeclaration) => boolean
): ts.FunctionExpression | ts.ArrowFunction {
    // Create endpoint log statement
    const endpointLog = createEndpointLogStatement(method, path, fileName)

    if (ts.isFunctionExpression(handler)) {
        if (!handler.body) return handler

        // First add endpoint log, then apply normal function instrumentation
        const bodyWithEndpointLog = ts.factory.createBlock([
            endpointLog,
            ...handler.body.statements
        ], true)

        // Apply normal function instrumentation
        const functionName = handler.name?.text || 'handler'
        const instrumentedBody = createInstrumentedBody(
            bodyWithEndpointLog,
            functionName,
            fileName,
            handler.parameters,
            isAsyncFunction(handler),
            '',
            context
        )

        return ts.factory.updateFunctionExpression(
            handler,
            handler.modifiers,
            handler.asteriskToken,
            handler.name,
            handler.typeParameters,
            handler.parameters,
            handler.type,
            instrumentedBody
        )
    } else { // ArrowFunction
        let bodyWithEndpointLog: ts.Block

        if (ts.isBlock(handler.body)) {
            // Block body - add endpoint log as first statement
            bodyWithEndpointLog = ts.factory.createBlock([
                endpointLog,
                ...handler.body.statements
            ], true)
        } else {
            // Expression body - convert to block with endpoint log
            const returnStatement = ts.factory.createReturnStatement(handler.body)
            bodyWithEndpointLog = ts.factory.createBlock([
                endpointLog,
                returnStatement
            ], true)
        }

        // Apply normal function instrumentation
        const functionName = 'handler'
        const instrumentedBody = createInstrumentedBody(
            bodyWithEndpointLog,
            functionName,
            fileName,
            handler.parameters,
            isAsyncFunction(handler),
            '',
            context
        )

        return ts.factory.updateArrowFunction(
            handler,
            handler.modifiers,
            handler.typeParameters,
            handler.parameters,
            handler.type,
            handler.equalsGreaterThanToken,
            instrumentedBody
        )
    }
}

function createEndpointLogStatement(method: string, path: string, fileName: string): ts.ExpressionStatement {
    const logMessage = ts.factory.createStringLiteral(`ENDPOINT|${method}|${path}|${fileName}`)
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

/**
 * Wraps a function reference (identifier) with endpoint logging
 */
function wrapFunctionReferenceWithLogging(
    functionRef: ts.Identifier,
    method: string,
    path: string,
    fileName: string
): ts.ArrowFunction {
    // Create endpoint log statement
    const endpointLog = createEndpointLogStatement(method, path, fileName)

    // Create parameters for the wrapper function (req, res, next?)
    const reqParam = ts.factory.createParameterDeclaration(
        undefined,
        undefined,
        'req'
    )
    const resParam = ts.factory.createParameterDeclaration(
        undefined,
        undefined,
        'res'
    )
    const nextParam = ts.factory.createParameterDeclaration(
        undefined,
        undefined,
        'next'
    )

    // Create call to original function
    const originalCall = ts.factory.createCallExpression(
        functionRef,
        undefined,
        [
            ts.factory.createIdentifier('req'),
            ts.factory.createIdentifier('res'),
            ts.factory.createIdentifier('next')
        ]
    )

    // Create return statement for the original call
    const returnStatement = ts.factory.createReturnStatement(originalCall)

    // Create function body with endpoint log and original call
    const body = ts.factory.createBlock([
        endpointLog,
        returnStatement
    ], true)

    // Create arrow function wrapper
    return ts.factory.createArrowFunction(
        [ts.factory.createModifier(ts.SyntaxKind.AsyncKeyword)], // Make it async to handle both sync and async handlers
        undefined,
        [reqParam, resParam, nextParam],
        undefined,
        ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        body
    )
} 