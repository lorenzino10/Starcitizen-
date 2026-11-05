// Vettori 3D in metri. Oggetti {x, y, z} immutabili per convenzione.
// I Number JS sono double IEEE-754: a 1e11 m l'errore relativo e' ~1e-16.

export const vec = (x, y, z) => ({ x: +x, y: +y, z: +z });
export const ORIGIN = vec(0, 0, 0);
export const add = (a, b) => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a, k) => vec(a.x * k, a.y * k, a.z * k);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const norm2 = (a) => dot(a, a);
export const norm = (a) => Math.sqrt(norm2(a));
export const distance = (a, b) => norm(sub(b, a));
export const fromArray = ([x, y, z]) => vec(x, y, z);
export const toArray = (a) => [a.x, a.y, a.z];
