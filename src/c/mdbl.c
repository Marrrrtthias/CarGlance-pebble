#include <pebble.h>

int main(void) {
  Window *w = window_create();
  window_stack_push(w, true);

  // The default 32 kB machine is too small for Piu: launch aborts with
  // "memory full". These sizes mirror src/embeddedjs/manifest.json
  // (config.creation) and pebble-ui's recommendation.
  moddable_createMachine(&(ModdableCreationRecord){
    .recordSize = sizeof(ModdableCreationRecord),
#ifdef PBL_DEBUG
    // Built with `pebble build --debug`: enable the xsbug JavaScript debugger.
    .flags = kModdableCreationFlagDebug,
#endif
    .stack = 5120,
    .slot = 45056,
    .chunk = 21504,
  });

  window_destroy(w);
  return 0;
}
