import { MathfieldElement } from "mathlive";

/**
 * Point MathLive at fonts/sounds copied into /public/mathlive (see build step).
 * Without this it tries to load from the hashed Vite deps path and fails offline.
 */
MathfieldElement.fontsDirectory = "/mathlive/fonts";
MathfieldElement.soundsDirectory = "/mathlive/sounds";
