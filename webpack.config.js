const path = require("path");
const JavaScriptObfuscator = require("webpack-obfuscator");

module.exports = {
  entry: {
    extension: "./src/extension.js",
    symbolCacheWorker: "./src/symbolCacheWorker.js",
    alparser: "./al-parser-lib/alparser.js",
    calParser: "./al-parser-lib/calParser.js",
  },
  target: "node",
  mode: "production",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    libraryTarget: "commonjs2",
  },
  externals: {
    vscode: "commonjs vscode",
  },
  resolve: {
    extensions: [".js"],
    fallback: {
      debug: false,
    },
  },
  plugins: [
    new JavaScriptObfuscator({
      rotateStringArray: true,
      stringArray: true,
      stringArrayEncoding: ["base64"],
      identifierNamesGenerator: "hexadecimal",
      renameGlobals: false,
      selfDefending: true,
    }),
  ],
};
