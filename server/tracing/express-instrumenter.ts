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
 * Adds endpoint logging to Express route handlers
 */
export function addSimpleEndpointLogging(
    handler: ts.FunctionExpression | ts.ArrowFunction,
    method: string,
    path: string,
    fileName: string
): ts.FunctionExpression | ts.ArrowFunction {
    // Add endpoint log with request data using our consistent pattern
    const endpointLog = ts.factory.createExpressionStatement(
        ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(
                ts.factory.createIdentifier('console'),
                'log'
            ),
            undefined,
            [ts.factory.createTemplateExpression(
                ts.factory.createTemplateHead(`ENTER|ENDPOINT|${method}|${path}|${fileName}|`),
                [ts.factory.createTemplateSpan(
                    createSafeToStringCall(
                        ts.factory.createPropertyAccessExpression(
                            ts.factory.createIdentifier('req'),
                            'body'
                        )
                    ),
                    ts.factory.createTemplateTail('')
                )]
            )]
        )
    )

    if (ts.isFunctionExpression(handler)) {
        if (!handler.body) return handler

        const newBody = ts.factory.createBlock([
            endpointLog,
            ...handler.body.statements
        ], true)

        return ts.factory.updateFunctionExpression(
            handler,
            handler.modifiers,
            handler.asteriskToken,
            handler.name,
            handler.typeParameters,
            handler.parameters,
            handler.type,
            newBody
        )
    } else { // ArrowFunction
        let newBody: ts.Block

        if (ts.isBlock(handler.body)) {
            newBody = ts.factory.createBlock([
                endpointLog,
                ...handler.body.statements
            ], true)
        } else {
            const returnStatement = ts.factory.createReturnStatement(handler.body)
            newBody = ts.factory.createBlock([
                endpointLog,
                returnStatement
            ], true)
        }

        return ts.factory.updateArrowFunction(
            handler,
            handler.modifiers,
            handler.typeParameters,
            handler.parameters,
            handler.type,
            handler.equalsGreaterThanToken,
            newBody
        )
    }
}

function createSafeToStringCall(valueExpression: ts.Expression): ts.Expression {
    // Generate: safeToString(value)
    return ts.factory.createCallExpression(
        ts.factory.createIdentifier('safeToString'),
        undefined,
        [valueExpression]
    )
} 