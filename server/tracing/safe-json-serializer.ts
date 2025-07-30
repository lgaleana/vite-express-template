import * as ts from 'typescript'

// Create the ultra-simple safeToString function that will be injected into each file
export function createSafeToStringFunction(): ts.Statement {
    return ts.factory.createFunctionDeclaration(
        undefined,
        undefined,
        'safeToString',
        undefined,
        [ts.factory.createParameterDeclaration(undefined, undefined, 'value')],
        undefined,
        ts.factory.createBlock([
            // Consistent JSON.stringify with Error handling in replacer
            ts.factory.createTryStatement(
                ts.factory.createBlock([
                    ts.factory.createReturnStatement(
                        ts.factory.createCallExpression(
                            ts.factory.createPropertyAccessExpression(
                                ts.factory.createIdentifier('JSON'),
                                'stringify'
                            ),
                            undefined,
                            [
                                ts.factory.createIdentifier('value'),
                                // Replacer function to handle Error objects
                                ts.factory.createArrowFunction(
                                    undefined,
                                    undefined,
                                    [
                                        ts.factory.createParameterDeclaration(undefined, undefined, 'key'),
                                        ts.factory.createParameterDeclaration(undefined, undefined, 'val')
                                    ],
                                    undefined,
                                    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                                    ts.factory.createBlock([
                                        // Check if value is Error and convert to string
                                        ts.factory.createIfStatement(
                                            ts.factory.createBinaryExpression(
                                                ts.factory.createIdentifier('val'),
                                                ts.SyntaxKind.InstanceOfKeyword,
                                                ts.factory.createIdentifier('Error')
                                            ),
                                            ts.factory.createBlock([
                                                ts.factory.createReturnStatement(
                                                    ts.factory.createCallExpression(
                                                        ts.factory.createIdentifier('String'),
                                                        undefined,
                                                        [ts.factory.createIdentifier('val')]
                                                    )
                                                )
                                            ], true)
                                        ),

                                        // Return value as-is for non-Error objects
                                        ts.factory.createReturnStatement(
                                            ts.factory.createIdentifier('val')
                                        )
                                    ], true)
                                )
                            ]
                        )
                    )
                ], true),

                // If JSON.stringify fails, try String()
                ts.factory.createCatchClause(
                    ts.factory.createVariableDeclaration('e'),
                    ts.factory.createBlock([
                        ts.factory.createTryStatement(
                            ts.factory.createBlock([
                                ts.factory.createReturnStatement(
                                    ts.factory.createCallExpression(
                                        ts.factory.createIdentifier('String'),
                                        undefined,
                                        [ts.factory.createIdentifier('value')]
                                    )
                                )
                            ], true),

                            // Final fallback
                            ts.factory.createCatchClause(
                                ts.factory.createVariableDeclaration('e2'),
                                ts.factory.createBlock([
                                    ts.factory.createReturnStatement(
                                        ts.factory.createStringLiteral('[stringify error]')
                                    )
                                ], true)
                            ),

                            undefined
                        )
                    ], true)
                ),

                undefined
            )
        ], true)
    )
} 