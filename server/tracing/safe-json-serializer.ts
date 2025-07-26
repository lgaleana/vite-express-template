import * as ts from 'typescript'

/**
 * Creates a TypeScript AST node for a safe JSON.stringify call that handles circular references
 * and Express objects without throwing errors.
 */
export function createSafeJsonStringifyCall(args: ts.Expression[]): ts.CallExpression {
    return ts.factory.createCallExpression(
        ts.factory.createArrowFunction(
            undefined,
            undefined,
            [],
            undefined,
            ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            ts.factory.createBlock([
                ts.factory.createVariableStatement(
                    undefined,
                    ts.factory.createVariableDeclarationList([
                        ts.factory.createVariableDeclaration(
                            'visited',
                            undefined,
                            undefined,
                            ts.factory.createNewExpression(
                                ts.factory.createIdentifier('WeakSet'),
                                undefined,
                                []
                            )
                        )
                    ], ts.NodeFlags.Const)
                ),
                ts.factory.createReturnStatement(
                    ts.factory.createCallExpression(
                        ts.factory.createPropertyAccessExpression(
                            ts.factory.createIdentifier('JSON'),
                            'stringify'
                        ),
                        undefined,
                        [
                            ts.factory.createArrayLiteralExpression(args),
                            createSafeReplacerFunction()
                        ]
                    )
                )
            ], true)
        ),
        undefined,
        []
    )
}

/**
 * Creates a replacer function that safely handles:
 * - Express request/response objects (converts to [Request]/[Response])
 * - Circular references (converts to [Circular] using WeakSet tracking)
 * - Regular objects (preserves as-is)
 */
function createSafeReplacerFunction(): ts.ArrowFunction {
    return ts.factory.createArrowFunction(
        undefined,
        undefined,
        [
            ts.factory.createParameterDeclaration(undefined, undefined, 'key'),
            ts.factory.createParameterDeclaration(undefined, undefined, 'value')
        ],
        undefined,
        ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        ts.factory.createBlock([
            ts.factory.createTryStatement(
                ts.factory.createBlock([
                    ts.factory.createIfStatement(
                        ts.factory.createBinaryExpression(
                            ts.factory.createBinaryExpression(
                                ts.factory.createTypeOfExpression(ts.factory.createIdentifier('value')),
                                ts.factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
                                ts.factory.createStringLiteral('object')
                            ),
                            ts.factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
                            ts.factory.createBinaryExpression(
                                ts.factory.createIdentifier('value'),
                                ts.factory.createToken(ts.SyntaxKind.ExclamationEqualsEqualsToken),
                                ts.factory.createNull()
                            )
                        ),
                        ts.factory.createBlock([
                            // Check if we've already visited this object (circular reference)
                            ts.factory.createIfStatement(
                                ts.factory.createCallExpression(
                                    ts.factory.createPropertyAccessExpression(
                                        ts.factory.createIdentifier('visited'),
                                        'has'
                                    ),
                                    undefined,
                                    [ts.factory.createIdentifier('value')]
                                ),
                                ts.factory.createReturnStatement(
                                    ts.factory.createStringLiteral('[Circular]')
                                )
                            ),

                            // Add this object to visited set
                            ts.factory.createExpressionStatement(
                                ts.factory.createCallExpression(
                                    ts.factory.createPropertyAccessExpression(
                                        ts.factory.createIdentifier('visited'),
                                        'add'
                                    ),
                                    undefined,
                                    [ts.factory.createIdentifier('value')]
                                )
                            ),

                            // Check for Express IncomingMessage (req)
                            ts.factory.createIfStatement(
                                ts.factory.createBinaryExpression(
                                    ts.factory.createBinaryExpression(
                                        ts.factory.createPropertyAccessExpression(
                                            ts.factory.createIdentifier('value'),
                                            'constructor'
                                        ),
                                        ts.factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
                                        ts.factory.createPropertyAccessExpression(
                                            ts.factory.createPropertyAccessExpression(
                                                ts.factory.createIdentifier('value'),
                                                'constructor'
                                            ),
                                            'name'
                                        )
                                    ),
                                    ts.factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
                                    ts.factory.createStringLiteral('IncomingMessage')
                                ),
                                ts.factory.createReturnStatement(
                                    ts.factory.createStringLiteral('[Request]')
                                )
                            ),
                            // Check for Express ServerResponse (res)
                            ts.factory.createIfStatement(
                                ts.factory.createBinaryExpression(
                                    ts.factory.createBinaryExpression(
                                        ts.factory.createPropertyAccessExpression(
                                            ts.factory.createIdentifier('value'),
                                            'constructor'
                                        ),
                                        ts.factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
                                        ts.factory.createPropertyAccessExpression(
                                            ts.factory.createPropertyAccessExpression(
                                                ts.factory.createIdentifier('value'),
                                                'constructor'
                                            ),
                                            'name'
                                        )
                                    ),
                                    ts.factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
                                    ts.factory.createStringLiteral('ServerResponse')
                                ),
                                ts.factory.createReturnStatement(
                                    ts.factory.createStringLiteral('[Response]')
                                )
                            )
                        ])
                    ),
                    // Return the value as-is for all other cases
                    ts.factory.createReturnStatement(
                        ts.factory.createIdentifier('value')
                    )
                ], true),
                // Catch block for any serialization errors
                ts.factory.createCatchClause(
                    ts.factory.createVariableDeclaration('err'),
                    ts.factory.createBlock([
                        ts.factory.createReturnStatement(
                            ts.factory.createStringLiteral('[Object]')
                        )
                    ], true)
                ),
                undefined
            )
        ], true)
    )
} 