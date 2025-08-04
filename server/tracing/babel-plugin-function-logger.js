module.exports = function () {
  const t = require('@babel/types');

  return {
    visitor: {
      Function(path) {
        const functionName = getFunctionName(path.node);
        if (!functionName) return; // Skip anonymous functions

        const fileName = this.file.opts.filename?.split('/').pop() || 'unknown';

        // Inject logging into function body
        injectLogging(path, functionName, fileName);
      },

      CallExpression(path) {
        if (isExpressRouteCall(path.node)) {
          const fileName = this.file.opts.filename?.split('/').pop() || 'unknown';
          instrumentExpressRoute(path, fileName);
        }
      }
    }
  };

  function getFunctionName(node) {
    // Function declarations: function foo() {}
    if (node.id && node.id.name) return node.id.name;

    // Method definitions: class methods, object methods
    if (node.key && node.key.name) return node.key.name;

    // Variable declarations: const foo = function() {}
    const parent = node.parent;
    if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.name) {
      return parent.id.name;
    }

    // Property assignments: obj.foo = function() {}
    if (parent && parent.type === 'Property' && parent.key && parent.key.name) {
      return parent.key.name;
    }

    return null;
  }

  function injectLogging(path, functionName, fileName) {

    if (!path.node.body || path.node.body.type !== 'BlockStatement') {
      // Arrow functions with expression bodies: () => expr
      // Convert to block statement
      const returnStmt = t.returnStatement(path.node.body);
      path.node.body = t.blockStatement([returnStmt]);
    }

    const isAsync = path.node.async;
    const originalStatements = [...path.node.body.body];

    // Entry log: ENTER|FUNCTION|file||name|args
    const entryLog = t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier('console'), t.identifier('log')),
        [t.templateLiteral([
          t.templateElement({ raw: `ENTER|FUNCTION|${fileName}||${functionName}|` }),
          t.templateElement({ raw: '' })
        ], [
          t.callExpression(t.identifier('safeToString'), [
            t.arrayExpression([t.spreadElement(t.identifier('arguments'))])
          ])
        ])]
      )
    );

    // Exit log: EXIT|FUNCTION|file||name|result
    const createExitLog = (resultVar) => t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier('console'), t.identifier('log')),
        [t.templateLiteral([
          t.templateElement({ raw: `EXIT|FUNCTION|${fileName}||${functionName}|` }),
          t.templateElement({ raw: '' })
        ], [
          t.callExpression(t.identifier('safeToString'), [resultVar])
        ])]
      )
    );

    // Error log: ERROR|FUNCTION|file||name|error
    const errorLog = t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier('console'), t.identifier('log')),
        [t.templateLiteral([
          t.templateElement({ raw: `ERROR|FUNCTION|${fileName}||${functionName}|` }),
          t.templateElement({ raw: '' })
        ], [
          t.callExpression(t.identifier('safeToString'), [t.identifier('__error')])
        ])]
      )
    );

    if (isAsync) {
      // Async function handling
      const wrappedBody = [
        entryLog,
        t.tryStatement(
          t.blockStatement([
            t.variableDeclaration('const', [
              t.variableDeclarator(
                t.identifier('__result'),
                t.awaitExpression(
                  t.callExpression(
                    t.arrowFunctionExpression([], t.blockStatement(originalStatements), true),
                    []
                  )
                )
              )
            ]),
            createExitLog(t.identifier('__result')),
            t.returnStatement(t.identifier('__result'))
          ]),
          t.catchClause(
            t.identifier('__error'),
            t.blockStatement([errorLog, t.throwStatement(t.identifier('__error'))])
          )
        )
      ];
      path.node.body = t.blockStatement(wrappedBody);
    } else {
      // Sync function handling
      const wrappedBody = [
        entryLog,
        t.tryStatement(
          t.blockStatement([
            t.variableDeclaration('const', [
              t.variableDeclarator(
                t.identifier('__result'),
                t.callExpression(
                  t.arrowFunctionExpression([], t.blockStatement(originalStatements)),
                  []
                )
              )
            ]),
            createExitLog(t.identifier('__result')),
            t.returnStatement(t.identifier('__result'))
          ]),
          t.catchClause(
            t.identifier('__error'),
            t.blockStatement([errorLog, t.throwStatement(t.identifier('__error'))])
          )
        )
      ];
      path.node.body = t.blockStatement(wrappedBody);
    }
  }

  // Express route detection and instrumentation
  function isExpressRouteCall(node) {

    if (!t.isMemberExpression(node.callee)) return false;

    const methodName = t.isIdentifier(node.callee.property) ? node.callee.property.name : null;
    const receiver = node.callee.object;

    const EXPRESS_METHODS = ['get', 'post', 'put', 'delete'];

    return !!(methodName && EXPRESS_METHODS.includes(methodName) &&
      t.isIdentifier(receiver) &&
      (receiver.name === 'app' || receiver.name === 'router'));
  }

  function extractRoutePath(node) {
    const firstArg = node.arguments[0];

    if (t.isStringLiteral(firstArg)) {
      return firstArg.value;
    }
    return '/*';
  }

  function instrumentExpressRoute(path, fileName) {
    const node = path.node;

    const methodName = t.isIdentifier(node.callee.property) ? node.callee.property.name : null;
    const routePath = extractRoutePath(node);

    if (!methodName) return;

    // Instrument handler functions in the arguments
    const instrumentedArgs = node.arguments.map(arg => {
      if (t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg)) {
        return addEndpointLogging(arg, methodName.toUpperCase(), routePath, fileName);
      }
      return arg;
    });

    // Update the call expression with instrumented handlers
    path.replaceWith(
      t.callExpression(node.callee, instrumentedArgs)
    );
  }

  function addEndpointLogging(handler, method, routePath, fileName) {

    // Create endpoint log: ENTER|ENDPOINT|METHOD|PATH|FILENAME|req.body
    const endpointLog = t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier('console'), t.identifier('log')),
        [t.templateLiteral([
          t.templateElement({ raw: `ENTER|ENDPOINT|${method}|${routePath}|${fileName}|` }),
          t.templateElement({ raw: '' })
        ], [
          t.callExpression(t.identifier('safeToString'), [
            t.memberExpression(t.identifier('req'), t.identifier('body'))
          ])
        ])]
      )
    );

    if (t.isFunctionExpression(handler)) {
      if (!handler.body || !t.isBlockStatement(handler.body)) return handler;

      const newBody = t.blockStatement([
        endpointLog,
        ...handler.body.body
      ]);

      return t.functionExpression(
        handler.id,
        handler.params,
        newBody,
        handler.generator,
        handler.async
      );
    } else if (t.isArrowFunctionExpression(handler)) {
      let newBody;

      if (t.isBlockStatement(handler.body)) {
        newBody = t.blockStatement([
          endpointLog,
          ...handler.body.body
        ]);
      } else {
        // Arrow function with expression body
        const returnStatement = t.returnStatement(handler.body);
        newBody = t.blockStatement([
          endpointLog,
          returnStatement
        ]);
      }

      return t.arrowFunctionExpression(
        handler.params,
        newBody,
        handler.async
      );
    }

    return handler;
  }
}; 