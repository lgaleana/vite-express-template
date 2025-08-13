import { Project, SourceFile, Node, SyntaxKind, ObjectLiteralExpression, PropertyAssignment, MethodDeclaration as ObjectMethodDeclaration } from 'ts-morph';
import { instrumentExpressEndpointsAst } from './express-endpoint-instrumenter.js';
import * as path from 'path';

/**
 * Function instrumentation for module-scope functions using ts-morph
 * Goals:
 * - 100% coverage of module-scope functions (exclude generators), including async
 * - Logs inputs/outputs/errors
 * - 0% chance of breaking at runtime (instrumented build only; no source edits)
 * - Minimal, simple logs in format:
 *   ACTION|FUNCTION|FILE|CLASS_OR_OBJECT|NAME|INPUT_OR_OUTPUT_OR_ERROR
 */

interface FunctionInfo {
    name: string;
    isAsync: boolean;
    wrapperCode: string;
    className?: string;
    isStatic?: boolean;
}

// (endpoint instrumentation moved to express-endpoint-instrumenter.ts)

export class TSMorphFunctionTracer {
    private project: Project;

    constructor() {
        this.project = new Project({
            useInMemoryFileSystem: true,
            compilerOptions: {
                target: 99, // Latest
                module: 99, // ESNext
                moduleResolution: 2, // Node
                allowSyntheticDefaultImports: true,
                esModuleInterop: true
            }
        });
    }

    public instrumentFile(filePath: string, sourceCode: string): string {
        // Parse source file
        const sourceFile = this.project.createSourceFile('temp.ts', sourceCode, { overwrite: true });
        const fileName = path.basename(filePath);

        // 1) Module-scope variable functions and object-literal methods → initializer/body replacement (no rebinding)
        this.instrumentTopLevelVariableFunctions(sourceFile, fileName);
        this.instrumentTopLevelObjectLiteralMethods(sourceFile, fileName);
        this.instrumentExportDefaultFunctionExpressions(sourceFile, fileName);

        // 2) Express endpoints (inline + named handlers at call sites)
        instrumentExpressEndpointsAst(sourceFile, fileName);

        // 3) Collect safe wrapper targets (top-level function declarations and class methods)
        const functionsToWrap: FunctionInfo[] = [];
        this.findAllNamedFunctions(sourceFile, functionsToWrap, fileName);

        // 4) Print modified source and append wrappers + safe serializer
        const instrumentedBase = sourceFile.getFullText();
        const safeSerializerCode = this.generateSafeToString();
        const wrapperCode = this.generateAllWrappers(functionsToWrap);
        return instrumentedBase + '\n\n' + safeSerializerCode + '\n\n' + wrapperCode;
    }

    private findAllNamedFunctions(sourceFile: SourceFile, functions: FunctionInfo[], fileName: string) {
        // Only wrap top-level function declarations and top-level class methods
        const isTopLevel = (node: Node): boolean => node.getParent()?.getKind() === SyntaxKind.SourceFile;
        sourceFile.forEachDescendant((node) => {
            // 1. Regular function declarations
            if (Node.isFunctionDeclaration(node) && isTopLevel(node)) {
                const name = node.getName();
                // Skip generators if any
                if (name && !node.isGenerator()) {
                    functions.push({
                        name,
                        isAsync: node.isAsync(),
                        wrapperCode: this.createStandaloneWrapper(name, node.isAsync(), fileName)
                    });
                }
            }

            // 2. Class methods (instance and static)
            else if (Node.isMethodDeclaration(node)) {
                const name = node.getName();
                const className = this.getClassName(node);
                // Only wrap methods of top-level classes
                const classNode = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
                const classIsTopLevel = classNode?.getParent()?.getKind() === SyntaxKind.SourceFile;
                if (name && className && classIsTopLevel) {
                    // Skip hard private methods (#name) which cannot be reassigned externally
                    if (name.startsWith('#')) return;
                    const isStatic = node.hasModifier(SyntaxKind.StaticKeyword);
                    functions.push({
                        name,
                        isAsync: node.isAsync(),
                        className,
                        isStatic,
                        wrapperCode: this.createClassMethodWrapper(name, node.isAsync(), fileName, className, isStatic)
                    });
                }
            }
            // 3. Exported default assigned function expression
            else if (Node.isExportAssignment(node)) {
                // Export default handled via expression replacement to avoid unsafe rebinding
                return;
            }
        });
    }

    private getClassName(node: Node): string | null {
        let current = node.getParent();
        while (current) {
            if (Node.isClassDeclaration(current)) {
                return current.getName() || null;
            }
            current = current.getParent();
        }
        return null;
    }

    private createStandaloneWrapper(functionName: string, isAsync: boolean, fileName: string): string {
        const originalVar = `__original_${functionName}`;
        // Single wrapper that preserves async/sync by checking for thenable
        return `
{
    const ${originalVar} = ${functionName};
    ${functionName} = function(...args) {
        console.log(\`ENTER|FUNCTION|${fileName}||${functionName}|\${safeToString(args)}\`);
        try {
            const out = ${originalVar}.apply(this, args);
            if (out && typeof out.then === 'function') {
                return out.then(v => { console.log(\`EXIT|FUNCTION|${fileName}||${functionName}|\${safeToString(v)}\`); return v; })
                          .catch(e => { console.error(\`ERROR|FUNCTION|${fileName}||${functionName}|\${safeToString(e)}\`); throw e; });
            }
            console.log(\`EXIT|FUNCTION|${fileName}||${functionName}|\${safeToString(out)}\`);
            return out;
        } catch (error) {
            console.error(\`ERROR|FUNCTION|${fileName}||${functionName}|\${safeToString(error)}\`);
            throw error;
        }
    };
}`;
    }

    private createClassMethodWrapper(functionName: string, isAsync: boolean, fileName: string, className: string, isStatic: boolean): string {
        const originalVar = `__original_${functionName}`;
        const accessor = isStatic ? `${className}.${functionName}` : `${className}.prototype.${functionName}`;
        return `
{
    const ${originalVar} = ${accessor};
    ${accessor} = function(...args) {
        console.log(\`ENTER|FUNCTION|${fileName}|${className}|${functionName}|\${safeToString(args)}\`);
        try {
            const out = ${originalVar}.apply(this, args);
            if (out && typeof out.then === 'function') {
                return out.then(v => { console.log(\`EXIT|FUNCTION|${fileName}|${className}|${functionName}|\${safeToString(v)}\`); return v; })
                          .catch(e => { console.error(\`ERROR|FUNCTION|${fileName}|${className}|${functionName}|\${safeToString(e)}\`); throw e; });
            }
            console.log(\`EXIT|FUNCTION|${fileName}|${className}|${functionName}|\${safeToString(out)}\`);
            return out;
        } catch (error) {
            console.error(\`ERROR|FUNCTION|${fileName}|${className}|${functionName}|\${safeToString(error)}\`);
            throw error;
        }
    };
}`;
    }

    // Generators are intentionally excluded per requirements

    private generateAllWrappers(functions: FunctionInfo[]): string {
        return functions.map(f => f.wrapperCode).join('\n');
    }

    private generateSafeToString(): string {
        return `
function safeToString(value) {
    try {
        return JSON.stringify(value, (key, val) => {
            if (val instanceof Error) {
                return String(val);
            }
            return val;
        });
    } catch (e) {
        try {
            return String(value);
        } catch (e2) {
            return '[stringify error]';
        }
    }
}`;
    }

    // --- New helpers for module-scope variable functions and object methods ---

    private instrumentTopLevelVariableFunctions(sourceFile: SourceFile, fileName: string) {
        const variableStatements = sourceFile.getVariableStatements();
        for (const vs of variableStatements) {
            const isTopLevel = vs.getParent()?.getKind() === SyntaxKind.SourceFile;
            if (!isTopLevel) continue;
            const kind = vs.getDeclarationKind(); // const/let/var
            for (const decl of vs.getDeclarations()) {
                const name = decl.getName();
                const init = decl.getInitializer();
                if (!init) continue;
                if (Node.isFunctionExpression(init) || Node.isArrowFunction(init)) {
                    // Replace initializer with a wrapped function expression (IIFE over original)
                    const wrapped = this.buildInitializerWrapper(name, '', fileName, init.getText());
                    decl.setInitializer(wrapped);
                } else if (Node.isObjectLiteralExpression(init)) {
                    // Object literal handled in separate method
                    continue;
                }
            }
        }
    }

    private instrumentExportDefaultFunctionExpressions(sourceFile: SourceFile, fileName: string) {
        const exportAssignments = sourceFile.getExportAssignments();
        for (const ex of exportAssignments) {
            const expr = ex.getExpression();
            if (!expr) continue;
            if (Node.isFunctionExpression(expr) || Node.isArrowFunction(expr)) {
                const wrapped = this.buildInitializerWrapper('default', '', fileName, expr.getText());
                ex.setExpression(wrapped);
            }
        }
    }

    private instrumentTopLevelObjectLiteralMethods(sourceFile: SourceFile, fileName: string) {
        const variableStatements = sourceFile.getVariableStatements();
        for (const vs of variableStatements) {
            const isTopLevel = vs.getParent()?.getKind() === SyntaxKind.SourceFile;
            if (!isTopLevel) continue;
            for (const decl of vs.getDeclarations()) {
                const varName = decl.getName();
                const init = decl.getInitializer();
                if (!init || !Node.isObjectLiteralExpression(init)) continue;
                this.wrapObjectLiteralProperties(init as ObjectLiteralExpression, varName, fileName);
            }
        }
    }

    private wrapObjectLiteralProperties(obj: ObjectLiteralExpression, objectName: string, fileName: string) {
        for (const prop of obj.getProperties()) {
            // Method shorthand: { foo(a){...} }
            if (Node.isMethodDeclaration(prop as any)) {
                const m = prop as unknown as ObjectMethodDeclaration;
                const key = m.getName();
                const originalText = m.getText();
                // Build a property assignment with function expression wrapper using original method as IIFE
                const asFunctionExpr = this.convertObjectMethodToFunctionExpression(originalText);
                const wrappedInit = this.buildInitializerWrapper(key, objectName, fileName, asFunctionExpr);
                m.replaceWithText(`${key}: ${wrappedInit}`);
            }
            // Property assignment with function value: { foo: function(){}, bar: ()=>{} }
            else if (Node.isPropertyAssignment(prop)) {
                const pa = prop as PropertyAssignment;
                const nameNode = pa.getNameNode();
                const key = nameNode.getText().replace(/['"`]/g, '');
                const init = pa.getInitializer();
                if (!init) continue;
                if (Node.isFunctionExpression(init) || Node.isArrowFunction(init)) {
                    const wrappedInit = this.buildInitializerWrapper(key, objectName, fileName, init.getText());
                    pa.setInitializer(wrappedInit);
                }
            }
        }
    }

    private convertObjectMethodToFunctionExpression(methodText: string): string {
        // methodText like: "foo(a,b) { ... }" possibly with modifiers; convert to function(a,b){...}
        // Simple heuristic: find first '(' as params start and '{' as body start
        const nameEnd = methodText.indexOf('(');
        const bodyStart = methodText.indexOf('{', nameEnd);
        const params = methodText.slice(nameEnd, bodyStart).trim();
        const body = methodText.slice(bodyStart).trim();
        return `function ${params} ${body}`;
    }

    private buildInitializerWrapper(name: string, objectOrClass: string, fileName: string, originalInitializer: string): string {
        // Wrap original initializer via IIFE to preserve original behavior and this/args
        // Handles async/sync by thenable detection; does not change signature
        const scopeField = objectOrClass ? objectOrClass : '';
        const enter = `ENTER|FUNCTION|${fileName}|${scopeField}|${name}|`;
        const exit = `EXIT|FUNCTION|${fileName}|${scopeField}|${name}|`;
        const error = `ERROR|FUNCTION|${fileName}|${scopeField}|${name}|`;
        return `((__orig) => function(...args){
    console.log(\`${enter}\${safeToString(args)}\`);
    try {
        const out = __orig.apply(this, args);
        if (out && typeof out.then === 'function') {
            return out.then(v => { console.log(\`${exit}\${safeToString(v)}\`); return v; })
                      .catch(e => { console.error(\`${error}\${safeToString(e)}\`); throw e; });
        }
        console.log(\`${exit}\${safeToString(out)}\`);
        return out;
    } catch (e) {
        console.error(\`${error}\${safeToString(e)}\`);
        throw e;
    }
})(${originalInitializer})`;
    }
}

// Simple interface for existing build system
export function instrumentSourceCode(filePath: string, sourceCode: string): string {
    const tracer = new TSMorphFunctionTracer();
    return tracer.instrumentFile(filePath, sourceCode);
} 