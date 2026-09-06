require("dotenv").config();


const app = require("./app");

const mongoose = require("mongoose");



const PORT =
process.env.PORT || 5000;



const connectDB = async()=>{

    try{

        await mongoose.connect(
            process.env.MONGO_URI
        );


        console.log(
            "✅ MongoDB Connected"
        );


    }
    catch(error){

        console.error(
            "❌ MongoDB Connection Failed:",
            error.message
        );


        process.exit(1);

    }

};




// ================================
// START SERVER
// ================================


const startServer = async()=>{


    await connectDB();


    app.listen(
        PORT,
        ()=>{

            console.log(
                `🚀 CloudOps AI Backend Started`
            );

            console.log(
                `🌐 http://localhost:${PORT}`
            );

        }
    );


};



startServer();