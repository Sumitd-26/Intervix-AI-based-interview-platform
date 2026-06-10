import express from "express";
import dotenv from "dotenv";
import connectDb from "./config/connectDB.js";
dotenv.config();

const app = express();

const PORT = process.env.PORT || 6000;

app.get("/", (req, res) => {
  return res.json({ message: "Server Started" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  connectDb();
});
