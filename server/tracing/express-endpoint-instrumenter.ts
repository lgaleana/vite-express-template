import { SourceFile, Node } from 'ts-morph';

// Express HTTP methods for endpoint detection
const EXPRESS_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'all']);

/**
 * Instruments Express endpoints in-place within the provided SourceFile.
 * - Inline handlers: wrap with ENTER/EXIT/ERROR logs.
 * - Named handlers: wrap to log ENTER with function name.
 * Log formats:
 *   Inline: ACTION|ENDPOINT|METHOD|ROUTE|FILE|INPUTS/OUTPUT/ERROR
 *   Named:  ENTER|ENDPOINT|METHOD|ROUTE|FILE|FUNCTION NAME
 */
export function instrumentExpressEndpointsAst(sourceFile: SourceFile, fileName: string): void {
    sourceFile.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return;
        const expression = node.getExpression();
        if (!Node.isPropertyAccessExpression(expression)) return;
        const methodName = expression.getName();
        const object = expression.getExpression();
        if (!EXPRESS_METHODS.has(methodName)) return;
        if (!Node.isIdentifier(object)) return;
        const objName = object.getText();
        if (objName !== 'app' && objName !== 'router') return;

        const args = node.getArguments();
        // Determine route path if first arg is string
        let routePath = '/*';
        const pathArg = args[0];
        if (pathArg && Node.isStringLiteral(pathArg)) routePath = pathArg.getLiteralValue();

        // Replace handler arguments starting after the path literal (or from 0 if absent)
        const startIdx = pathArg && Node.isStringLiteral(pathArg) ? 1 : 0;
        for (let i = startIdx; i < args.length; i++) {
            const a = args[i];
            if (Node.isFunctionExpression(a) || Node.isArrowFunction(a)) {
                const handlerText = a.getText();
                const wrapped = buildEndpointWrapperInline(handlerText, fileName, methodName.toUpperCase(), routePath);
                a.replaceWithText(wrapped);
            } else if (Node.isIdentifier(a)) {
                const handlerName = a.getText();
                const wrapped = buildEndpointWrapperRef(handlerName, fileName, methodName.toUpperCase(), routePath);
                a.replaceWithText(wrapped);
            }
        }
    });
}

// IIFE wrapping to preserve original inline handler as __h
function buildEndpointWrapperInline(originalHandlerText: string, fileName: string, method: string, route: string): string {
    // Logs: ACTION|ENDPOINT|METHOD|ROUTE|FILE|INPUT/OUTPUT/ERROR
    return `((__h) => (req, res, next) => {
    const __start = Date.now();
    if (res && typeof res.once === 'function') {
        try {
            res.once('finish', () => {
                const __dur = Date.now() - __start;
                const __out = { status: res.statusCode, duration_ms: __dur };
                console.log(\`EXIT|ENDPOINT|${method}|${route}|${fileName}|\${safeToString(__out)}\`);
            });
        } catch {}
    }
    const __in = { params: req?.params, query: req?.query, body: req?.body };
    console.log(\`ENTER|ENDPOINT|${method}|${route}|${fileName}|\${safeToString(__in)}\`);
    try {
        const out = __h(req, res, next);
        if (out && typeof out.then === 'function') {
            return out.catch(e => { console.error(\`ERROR|ENDPOINT|${method}|${route}|${fileName}|\${safeToString(e)}\`); throw e; });
        }
        return out;
    } catch (e) {
        console.error(\`ERROR|ENDPOINT|${method}|${route}|${fileName}|\${safeToString(e)}\`);
        throw e;
    }
})(${originalHandlerText})`;
}

function buildEndpointWrapperRef(handlerName: string, fileName: string, method: string, route: string): string {
    // Logs only ENTER with function name per requirement
    return `(req, res, next) => {
    console.log(\`ENTER|ENDPOINT|${method}|${route}|${fileName}|${handlerName}\`);
    return ${handlerName}(req, res, next);
}`;
}


