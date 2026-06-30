fn main() {
    // The bundled Google OAuth client is baked in via `option_env!` in auth.rs.
    // Cargo doesn't track env vars read by those macros, so without these directives
    // a cached build (e.g. CI's rust-cache) compiled before the secrets existed gets
    // reused and the creds silently never make it into the binary. Declaring the
    // dependency forces a recompile whenever a value changes.
    println!("cargo:rerun-if-env-changed=ZEN_GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=ZEN_GOOGLE_CLIENT_SECRET");

    tauri_build::build()
}
