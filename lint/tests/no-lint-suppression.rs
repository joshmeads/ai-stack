#![allow(dead_code)] // @hit
#[allow(clippy::too_many_arguments)] // @hit
fn a() {}
#[expect(unused)] // @hit
fn b() {}
#[derive(Debug)]
struct S;
#[cfg_attr(test, derive(Clone))]
struct U;
