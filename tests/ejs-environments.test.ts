import { compileOK, staticError } from './test-utils';

describe('ElementaryJS Environments', () => {
  const x: string = `You must initialize the variable 'x' before use.`;

  function compileError(code: string, msg: string = x) {
    expect(staticError(code)).toEqual(expect.arrayContaining([msg]));
  }

  test('Trivial uninitialized let (+)', () => {
    compileOK(`let x;`);
    compileOK(`let x; x = 1;`);
    compileOK(`let x; x = 1; x;`);
  });

  test('Trivial uninitialized let (-)', () => {
    compileError(`let x; x;`);
    compileError(`let x, y = x;`);
  });

  test('Undefined counts (+)', () => {
    compileOK(`let x; x = undefined; x;`);
    compileOK(`let x; x = void 0; x;`);
    compileOK(`let x; x = (() => {})(); x;`);
  });

  test('Array Expression (+)', () => {
    compileOK(`let x; x = '1'; [x];`);
  });

  test('Array Expression (-)', () => {
    compileError(`let x; [x];`);
  });

  test('Unary expression (+)', () => {
    compileOK(`let x; x = '1'; +x;`);
  });

  test('Unary expression (-)', () => {
    compileError(`let x; +x;`);
  });

  test('Update expression (+)', () => {
    compileOK(`let x; x = 1; ++x;`);
  });

  test('Update expression (-)', () => {
    compileError(`let x; ++x;`);
  });

  test('Basic shadowing (+)', () => {
    compileOK(`let x; { let x = 1; x; }`);
  });

  test('Basic shadowing (-)', () => {
    compileError(`let x; { let x = 1; x; } x;`);
  });

  test('Assignment in plain block (+)', () => {
    compileOK(`let x; { x = 1; x; } x;`);
    compileOK(`let x; { { x = 1; x; } x; } x;`);
  });

  test('Assignment in plain block (-)', () => {
    compileError(`let x; { x; x = 1; } x;`);
    compileError(`let x; { x; { x = 1; x; } } x;`);
  });

  test('While loop (+)', () => {
    compileOK(`let x, y = 0;
      while (y < 1) {
        x = 0; x; ++y;
      }
    `);
  });

  test('While loop (-)', () => {
    compileError(`let x, y = 0;
      while (y < 1) {
        x = 0; x; ++y;
      }
      x;
    `);
  });

  test('For loop (+)', () => {
    compileOK(`let x;
      for (x = 0; x < 10; ++x) { console.log(x); }
    `);
    compileOK(`let x, y;
      for (y = 0; y < 1; ++y) {
        x = 0; x; ++y;
      }
    `);
    // shadowing
    compileOK(`let x;
      for (let x = 0; x < 1; ++x) {}
    `);
    // init before test
    compileOK(`let x;
      for (x = 0; false; ++x) {}
      x;
    `);
  });

  test('For loop (-)', () => {
    compileError(`let x;
      for (let x = 0; x < 1; ++x) {}
      x;
    `);
    compileError(`let x, y;
      for (y = 0; y < 1; ++y) {
        x = 0; x; ++y;
      }
      x;
    `);
  });

  test('Do while loop (+)', () => {
    compileOK(`let x;
      do {
        x = 0; x;
      } while (false);
      x;
    `);
  });

  test('Function parameter shadowing (+)', () => {
    compileOK(`let x;
      function t(x) {
        return x;
      }
    `);
    compileOK(`let x, y = function t(x) { return x; };`);
    compileOK(`let x;
      class T {
        constructor(x) { this.x = x; }
      }
    `);
  });

  test('Function parameter shadowing (-)', () => {
    compileError(`let x;
      function t(x) {
        return x;
      }
      x;
    `);
    compileError(`let x, y = function t(x) { return x; }; x;`);
    compileError(`let x;
      class T {
        constructor(x) { this.x = x; }
      }
      x;
    `);
  });

  test('Function reference parent scope (-)', () => {
    compileError(`let x;
      function t() {
        return x;
      }
    `);
    compileError(`let x, y = function t() { return x; };`);
    compileError(`let x;
      class T {
        constructor() { this.x = x; }
      }
    `);
  });

  test('Function reference parent scope (+)', () => {
    compileOK(`let x;
      function t() {
        x = 1;
        return x;
      }
    `);
    compileOK(`let x, y = function t() { x = 0; return x; };`);
    compileOK(`let x;
      class T {
        constructor() { x = 0; this.x = x; }
      }
    `);
  });

  test('Function environment popped on exit (-)', () => {
    compileError(`let x;
      function t() {
        x = 1;
        return x;
      }
      x;
    `);
    compileError(`let x, y = function t() { x = 0; return x; }; x;`);
    compileError(`let x;
      class T {
        constructor() { x = 0; this.x = x; }
      }
      x;
    `);
    compileError(`let x;
      function t() {
        x = 1;
        return x;
      }
      t(); x;
    `);
    compileError(`let x, y = function t() { x = 0; return x; }; y(); x;`);
    compileError(`let x;
      class T {
        constructor() { x = 0; this.x = x; }
      }
      new T(); x;
    `);
  });

  test('Function environment popped on exit (+)', () => {
    compileOK(`let x;
      function t() {
        x = 1;
        return x;
      }
      x = t();
      x;
    `);
    compileOK(`let x, y = function t() { x = 0; return x; }; x = y(); x;`);
    compileOK(`let x;
      class T {
        constructor() { x = 0; this.x = x; }
      }
      x = new T();
      x;
    `);
  });

  test('Function environment popped on exit nested (+)', () => {
    compileOK(`
      function t() {
        let x, y = () => { x = 1; x; };
        return y();
      }
    `);
  });

  test('Function environment popped on exit nested (-)', () => {
    compileError(`
      function t() {
        let x, y = () => { x = 1; x; };
        return x;
      }
    `);
  });
});