const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const Dotenv = require('dotenv-webpack');
const demosdk_package = require("@kynesyslabs/demosdk");
const demosdk = demosdk_package.websdk


module.exports = {
  entry: "./src/scripts/main.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.js",
    publicPath: "/",
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/index.html",
    }),
    new Dotenv({
      systemvars: true, // Load all system environment variables as well
      safe: true, // Load '.env.example' to verify the '.env' variables are all set
    }),
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, "dist"),
    },
    compress: true,
    port: process.env.PORT || 4400,
    host: "0.0.0.0",
    allowedHosts: "all",
    historyApiFallback: true,
  },
};
