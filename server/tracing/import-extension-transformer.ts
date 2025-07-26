import * as ts from 'typescript'

export function createImportExtensionTransformer(): ts.TransformerFactory<ts.SourceFile> {
    return (context: ts.TransformationContext) => {
        return (sourceFile: ts.SourceFile) => {
            function visitor(node: ts.Node): ts.Node {
                // Handle import declarations
                if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                    const moduleSpecifier = node.moduleSpecifier.text

                    // Only transform relative imports that don't already have extensions
                    if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
                        if (!moduleSpecifier.endsWith('.js') && !moduleSpecifier.endsWith('.ts') && !moduleSpecifier.endsWith('.tsx')) {
                            const newModuleSpecifier = ts.factory.createStringLiteral(moduleSpecifier + '.js')
                            return ts.factory.updateImportDeclaration(
                                node,
                                node.modifiers,
                                node.importClause,
                                newModuleSpecifier,
                                node.attributes
                            )
                        }
                    }
                }

                // Handle export declarations
                if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                    const moduleSpecifier = node.moduleSpecifier.text

                    // Only transform relative imports that don't already have extensions
                    if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
                        if (!moduleSpecifier.endsWith('.js') && !moduleSpecifier.endsWith('.ts') && !moduleSpecifier.endsWith('.tsx')) {
                            const newModuleSpecifier = ts.factory.createStringLiteral(moduleSpecifier + '.js')
                            return ts.factory.updateExportDeclaration(
                                node,
                                node.modifiers,
                                node.isTypeOnly,
                                node.exportClause,
                                newModuleSpecifier,
                                node.attributes
                            )
                        }
                    }
                }

                return ts.visitEachChild(node, visitor, context)
            }

            return ts.visitNode(sourceFile, visitor) as ts.SourceFile
        }
    }
} 