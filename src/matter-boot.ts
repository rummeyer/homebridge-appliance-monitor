/**
 * Settles how matter.js treats the process, before matter.js is loaded.
 *
 * matter.js builds its default environment the moment `@matter/main` is first
 * imported, and by default it makes itself at home: it reads `config.json`
 * from the working directory — which for Homebridge is Homebridge's own
 * config.json, and which it would also write settings back into — parses the
 * command line, and installs its own SIGINT/SIGTERM and unhandled-error
 * handlers. None of that is right for a plugin sharing a process with
 * Homebridge.
 *
 * This module has to be imported before anything that imports `@matter/*`,
 * which is why index.ts imports it first. ES modules are evaluated in import
 * order, so that is enough.
 */
import { config } from '@matter/nodejs/config';

config.loadConfigFile = false;
config.loadProcessArgv = false;
config.trapProcessSignals = false;
config.trapUnhandledErrors = false;
config.setProcessExitCodeOnError = false;
