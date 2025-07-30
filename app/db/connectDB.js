import mongoose from 'mongoose';
import { DB_NAME } from '../constants.js';

const connectDB = async () => {
  try {
    const instanceOfconection = await mongoose.connect(
      `${process.env.MONGODB_URI}/${DB_NAME}`
    );
    console.log(
      // instanceOfconection.Connection,
      'mongodb connected successfully'
    );
  } catch (error) {
    console.log(error.message, 'mongoDB cannot connect');
    process.exit(1);
  }
};

export default connectDB;
