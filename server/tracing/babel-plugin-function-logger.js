module.exports = function () {
  return {
    visitor: {
      Function(path) {
        const functionName = getFunctionName(path.node);
        if (!functionName) return; // Skip anonymous functions

        const fileName = this.file.opts.filename?.split('/').pop() || 'unknown';

        // Inject logging into function body
        injectLogging(path, functionName, fileName);
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
    const t = require('@babel/types');

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
            t.callExpression(
              t.memberExpression(t.identifier('Array'), t.identifier('from')),
              [t.identifier('arguments')]
            )
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
}; 