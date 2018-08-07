/* This module contains the primary visitor that enforces the static checks
 * and inserts the dynamic checks of ElementaryJS. To the extent possible,
 * the visitor does not throw an exception if a static check fails. Instead,
 * it accumulates a list of errors in visitor state. Once the visitor
 * reaches the end, it throws the list of errors if it is non-empty.
 *
 * Guidelines on how to implement new checks:
 *
 * NodeType: {
 *   enter(path, st: S): {
 *     // Implement any static checks here by adding an error message by
 *     st.elem.error(<message>);
 *     // If the node is totally crazy and will break everything else, consider
 *     // using path.skip() to give up processing this part of the AST. You
 *     // can also use path.stop() to stop all further error-checks.
 *
 *     // If you are going to desugar this node, do it here and  *do not*
 *     // use path.skip(). i.e., desugaring needs to revisit the node.
 *   },
 *   exit(path, st: S): {
 *     // If you're going to implement a dynamic check, do it here and call
 *     // path.skip() to avoid checking generated code.
 *   }
 * }
 * 
 */

import * as t from 'babel-types';
import { Visitor, NodePath } from 'babel-traverse';
import { ElementarySyntaxError, CompileError } from './types';

let generalOperators = [
  "==",
  "!=",
];
let numOrStringOperators = [
  "+",
];
let numOperators = [
  "<=",
  ">=",
  "<",
  ">",
  "<<",
  ">>",
  ">>>",
  "-",
  "*",
  "/",
  "%",
  "&",
  "|",
  "^"
];
let allowedBinaryOperators =
  generalOperators.concat(numOrStringOperators, numOperators);

// This is the visitor state, which includes a list of errors. We throw
// this object if something goes wrong.Clients of ElementaryJS only rely on the
// CompileError interface.
export class State implements CompileError {

  // Allows clients to discriminate between CompileError and CompileResult.
  public kind: 'error' = 'error';

  constructor(public errors: ElementarySyntaxError[]) {
  }

  // Convenience method to add a new error
  error(path: NodePath<t.Node>, message: string) {
    this.errors.push({ line: path.node.loc.start.line, message: message });
  }

  // Convenience: object prints reasonably for debugging the implementation
  // of ElementaryJS.
  toString() {
    if (this.errors.length === 0) {
      return 'class State in ElementaryJS with no errors';
    }
    else {
      return 'class State in ElementaryJS With the following errors:\n' +
        this.errors.map(x => {
          const l = x.line;
          return `- ${x.message} (line ${l})`
        }).join('\n');
    }
  }
}

function dynCheck(name: string, ...args: t.Expression[]): t.CallExpression {
  const f = t.memberExpression(t.identifier('rts'), t.identifier(name), false);
  return t.callExpression(f, args);
}

interface S {
  elem: State,
  opts: {
    isOnline: boolean,
    runTests: boolean,
  }
}

// The expression that loads the runtime system.
function rtsExpression(st: S): t.Expression {
  if (st.opts.isOnline) {
    return t.identifier('elementaryjs');
  }
  else {
    return t.callExpression(t.identifier('require'),
      [t.stringLiteral('./runtime')]);
  }
}

function unassign(op: string) {
  switch (op) {
    case '+=': return '+';
    case '-=': return '-';
    case '*=': return '*';
    case '/=': return '/';
    case '%=': return '%';
    default: throw new Error(`should not happen`);
  }
}

function enclosingScopeBlock(path: NodePath<t.Node>): t.Statement[] {
  const parent = path.getFunctionParent().node;
  if (t.isProgram(parent)) {
    return parent.body;
  }
  else if (t.isFunctionExpression(parent) ||
    t.isFunctionDeclaration(parent) ||
    t.isObjectMethod(parent)) {
    return parent.body.body;
  }
  else {
    throw new Error(`parent is a ${parent.type}`);
  }
}

function propertyAsString(node: t.MemberExpression): t.Expression {
  if (node.computed) {
    return node.property;
  }
  else {
    return t.stringLiteral((node.property as t.Identifier).name);
  }
}

export const visitor: Visitor = {
  Program: {
    enter(path, st: S) {
      st.elem = new State([]);
    },
    exit(path, st: S) {
      if (path.node.body.length !== 0) {
        path.get('body.0').insertBefore(
          t.variableDeclaration('var', [
            t.variableDeclarator(t.identifier('rts'), rtsExpression(st))
          ]));
      }
      path.stop();

      if (st.elem.errors.length > 0) {
        throw st.elem;
      }
    }
  },
  VariableDeclarator(path, st: S) {
    if (path.node.id.type !== 'Identifier') {
      // TODO(arjun): This is an awful error message!
      st.elem.error(path, `Do not use destructuring patterns.`);
      // The remaining checks assume that the program is binding a simple
      // identifier.
      return;
    }
    if (!t.isExpression(path.node.init)) {
      let x = path.node.id.name;
      st.elem.error(path, `You must initialize the variable '${x}'.`);
    }
  },
  CallExpression(path, st: S) {
    if (path.node.callee.type === 'Identifier' &&
        path.node.callee.name === 'Array') {
      st.elem.error(path, `You must use the 'new' keyword to create a new array.`);
    }
  },
  MemberExpression: {
    exit(path: NodePath<t.MemberExpression>) {
      const parent = path.parent;
      // Some stupid cases to skip: o.x = v and ++o.x
      // In these cases, the l-value is a MemberExpression, but we tackle
      // these in the AssignmentExpression and UpdateExpression cases.
      if ((t.isUpdateExpression(parent) && parent.argument == path.node) ||
          (t.isAssignmentExpression(parent) && parent.left === path.node)) {
        return;
      }
      if (path.parent.type === 'CallExpression') {
        // TODO: Insert dynamic check for member functions.
        return;
      }
      const o = path.node.object;
      const p = path.node.property;
      if (path.node.computed === false) {
        if (!t.isIdentifier(p)) {
          // This should never happen
          throw new Error(`ElementaryJS expected id. in MemberExpression`);
        }
        path.replaceWith(dynCheck('dot', o, t.stringLiteral(p.name)));
        path.skip();
      } else {
        path.replaceWith(dynCheck('arrayBoundsCheck', o, p));
        path.skip();
      }
    }
  },
  AssignmentExpression: {
    enter(path, st: S) {
      // Disallow certain operators and patterns
      const allowed = ['=', '+=', '-=', '*=', '/=', '%='];
      const { operator: op, left, right } = path.node;
      if (allowed.includes(op) === false) {
        st.elem.error(path, `Do not use the '${op}' operator.`);
        path.skip();
        return;
      }
      if (!t.isIdentifier(left) && !t.isMemberExpression(left)) {
        st.elem.error(path, `Do not use patterns`);
        path.skip();
        return;
      }

      if (op === '=') {
        return;
      }

      // Desugar everything that is not '='
      if (t.isIdentifier(left)) {
        path.replaceWith(t.assignmentExpression('=', left,
          t.binaryExpression(unassign(op), left, right)));
      }
      else {
        // exp.x += rhs =>  tmp = exp, tmp.x = tmp.x + rhs
        const tmp = path.scope.generateUidIdentifier('tmp');
        enclosingScopeBlock(path).push(
          t.variableDeclaration('var', [
            t.variableDeclarator(tmp)
          ]));
        path.replaceWith(
          t.sequenceExpression([
            t.assignmentExpression('=', tmp, left.object),
            t.assignmentExpression('=',
              t.memberExpression(tmp, left.property, left.computed),
              t.binaryExpression(unassign(op),
                t.memberExpression(tmp, left.property, left.computed),
                path.node.right))]));
      }
    },
    exit(path, st: S) {
      const { left, right } = path.node;
      if (path.node.operator !== '=') {
        throw new Error(`desugaring error`);
      }
      if (!t.isIdentifier(left) && !t.isMemberExpression(left)) {
        throw new Error(`syntactic check error`);
      }


      if (t.isIdentifier(left)) {
        return;
      }

      if (left.computed) {
        // exp[x] = rhs => checkArray(exp, x, rhs)
        path.replaceWith(
          dynCheck('checkArray', left.object, left.property, right));
      } else {
        // exp.x = rhs => checkMember(exp, 'x', rhs)
        path.replaceWith(
          dynCheck('checkMember', left.object, propertyAsString(left),
            right));
      }
      path.skip();
    }
  },
  BinaryExpression: {
    enter(path, st: S) {
      let op = path.node.operator;
      if (!(allowedBinaryOperators.includes(op))) {
        st.elem.error(path, `Do not use the '${op}' operator.`);
        path.skip();
        return;
      } else if (generalOperators.includes(op)) {
        switch (op) {
          case "==": {
            path.node.operator = "===";
          } break;
          case "!=": {
            path.node.operator = "!==";
          } break;
        }
      }
    },
    exit(path, st: S) {
      // Original: a + b
      let op = path.node.operator;
      if (numOrStringOperators.includes(op)) {
        // Transformed: applyNumOrStringOp('+', a, b);
        path.replaceWith(dynCheck("applyNumOrStringOp",
          t.stringLiteral(op),
          path.node.left,
          path.node.right));
        path.skip();
      } else if (numOperators.includes(op)) {
        // Transformed: applyNumOp('+', a, b);
        path.replaceWith(dynCheck("applyNumOp",
          t.stringLiteral(op),
          path.node.left,
          path.node.right));
        path.skip();
      }
    }
  },
  UnaryExpression(path, st: S) {
    if (path.node.operator == 'delete' ||
      path.node.operator == 'typeof') {
      st.elem.error(path, `Do not use the '` + path.node.operator +
        `' operator.`);
    }
  },
  NewExpression: {
    enter(path, st: S) {

    },
    exit(path, st: S) {
      if (path.node.callee.type === 'Identifier' &&
          path.node.callee.name === 'Array'){
        // This is a new array declaration.
        // new Array(...) ==> new SafeArray(...)
        const safeArray = 
            t.memberExpression(t.identifier('rts'), t.identifier('SafeArray'), false);
        const replacement = t.newExpression(safeArray, path.node.arguments);
        path.replaceWith(replacement);
        path.skip;
      }
    }
  },
  UpdateExpression: {
    enter(path, st: S) {
      // Static checks
      if (path.node.prefix == false) {
        st.elem.error(
          path, `Do not use post-increment or post-decrement operators.`);
        return;
      }

    },
    exit(path: NodePath<t.UpdateExpression>, st: S) {
      const a = path.node.argument;
      if (a.type !== 'Identifier' && a.type !== 'MemberExpression') {
        throw new Error(`not an l-value in update expression`);
      }
      if (t.isIdentifier(a)) {
        // ++x ==> updateOnlyNumbers(++x), x
        const check = dynCheck('updateOnlyNumbers',
          t.stringLiteral(path.node.operator),
          a);
        path.replaceWith(t.sequenceExpression([check, path.node]));
        path.skip();
      } else {
        // replace with dyn check function that takes in both obj and member.
        path.replaceWith(dynCheck('checkUpdateOperand',
          t.stringLiteral(path.node.operator),
          a.object,
          propertyAsString(a)));
        path.skip();
      }
    }
  },
  ForStatement(path, st: S) {
    if (!t.isBlockStatement(path.node.body)) {
      st.elem.error(path, `Loop body must be enclosed in braces.`);
    }
  },
  WhileStatement(path, st: S) {
    if (!t.isBlockStatement(path.node.body)) {
      st.elem.error(path, `Loop body must be enclosed in braces.`);
    }
  },
  VariableDeclaration(path, st: S) {
    if (path.node.kind !== 'let' && path.node.kind !== 'const') {
      st.elem.error(path, `Use 'let' or 'const' to declare a variable.`);
    }
  },
  ThrowStatement(path, st: S) {
    st.elem.error(path, `Do not use the 'throw' operator.`);
  },
  WithStatement(path, st: S) {
    st.elem.error(path, `Do not use the 'with' statement.`);
  },
  SwitchStatement(path, st: S) {
    st.elem.error(path, `Do not use the 'switch' statement.`);
  },
  LabeledStatement(path, st: S) {
    st.elem.error(path, `Do not use labels to alter control-flow`);
  },
  ForOfStatement(path, st: S) {
    st.elem.error(path, `Do not use for-of loops.`);
  },
  ForInStatement(path, st: S) {
    st.elem.error(path, `Do not use for-in loops.`);
  },
}

// Allows ElementaryJS to be used as a Babel plugin.
export function plugin() {
  return { visitor: visitor };
}
