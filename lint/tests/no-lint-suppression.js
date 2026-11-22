// eslint-disable-next-line no-console @hit
console.log(1);
/* eslint-disable */ // @hit
// a normal comment
const x = 1; // @ts-ignore @hit
// @ts-expect-error @hit
const y = x;
// biome-ignore lint/style: reason @hit
export { y };
// ast-grep-ignore @hit
/* ast-grep-ignore: no-comments */ // @hit
// mentions ast-grep-ignore in prose
