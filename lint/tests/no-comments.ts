export interface H {
  /** Doc on an interface member. */
  x: number;
}

/** Doc on a decorated export. */
@sealed
export class G {}

// @ts-expect-error the fixture checks a deliberate mismatch
const n: number = "x";

function sealed(_: unknown) {}
// a prose comment after a function @hit
type Local = {
  /** doc on a member of a type that is not exported @hit */
  y: string;
};

export type Shape = {
  /** Doc on a member of an exported type. */
  side: number;
};
