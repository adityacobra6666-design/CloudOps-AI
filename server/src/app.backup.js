const express = require("express");
const cors = require("cors");


// Routes
const incidentRoutes = require("./routes/incident.route");
const authRoutes = require("./routes/auth.routes");


const app = express();


// ================================
// MIDDLEWARE
// ================================

app.use(
    cors({
        origin: "http://localhost:5173",
        credentials: true
    })
);


app.use(
    express.json()
);


app.use(
    express.urlencoded({
        extended: true
    })
);


// ================================
// HEALTH CHECK
// ================================

app.get(
    "/",
    (req, res) => {

        res.json({
            success:true,
            message:
            "CloudOps AI Backend Running 🚀"
        });

    }
);


// ================================
// API ROUTES
// ================================


app.use(
    "/api/auth",
    authRoutes
);


app.use(
    "/api/incidents",
    incidentRoutes
);



// ================================
// ERROR HANDLER
// ================================

app.use(
    (err, req, res, next)=>{

        console.error(
            "SERVER ERROR:",
            err.message
        );


        res.status(500).json({

            success:false,

            message:
            "Internal Server Error"

        });

    }
);



module.exports = app;