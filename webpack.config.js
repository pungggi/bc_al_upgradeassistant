const path = require("path");
const JavaScriptObfuscator = require("webpack-obfuscator");

module.exports = {
  entry: "./src/extension.js",
  target: "node",
  mode: "production",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
  },
  externals: {
    vscode: "commonjs vscode",
  },
  resolve: {
    extensions: [".js"],
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
