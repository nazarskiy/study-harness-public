"use strict";
const { createRequire } = require("node:module");
const { isAbsolute } = require("node:path");

exports.load = function load(filename) {
	if (!isAbsolute(filename)) throw new Error("Plugin entrypoint must be absolute");
	return createRequire(filename)(filename);
};
