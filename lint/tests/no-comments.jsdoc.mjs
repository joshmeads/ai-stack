const input = /** @type {HTMLInputElement} */ (document.querySelector("#name"));
/** @typedef {{ name: string }} Person */
/**
 * @param {Person} person
 * @returns {string}
 */
function greet(person) { return person.name; }
/** @template T @param {T} value */
const id = (value) => value;
/** @import { Shape } from "./shape.js" */
/** @satisfies {Person} */
const me = { name: "a" };
/** Says hello. @hit */
function hello() {}
/** @param person without a type @hit */
function bye(person) { return person; }
export { input, greet, id, me, hello, bye };
