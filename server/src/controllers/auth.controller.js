const User = require("../models/user.model");
const bcrypt = require("bcrypt");
const generateToken = require("../utils/generateToken");



// REGISTER

const register = async(req,res)=>{

try{

const {
name,
email,
password,
role
}=req.body;


const existingUser =
await User.findOne({email});


if(existingUser){

return res.status(400).json({
success:false,
message:"User already exists"
});

}



const hashedPassword =
await bcrypt.hash(
password,
10
);



const user =
await User.create({

name,

email,

password:hashedPassword,

role

});



const token =
generateToken(user);



res.status(201).json({

success:true,

token,

user:{
id:user._id,
name:user.name,
email:user.email,
role:user.role
}

});


}
catch(error){

res.status(500).json({

success:false,

message:error.message

});

}

};




// LOGIN

const login = async(req,res)=>{


try{


const {
email,
password
}=req.body;



const user =
await User.findOne({email});



if(!user){

return res.status(404).json({

success:false,

message:"Invalid credentials"

});

}




const match =
await bcrypt.compare(
password,
user.password
);



if(!match){

return res.status(401).json({

success:false,

message:"Invalid credentials"

});

}



const token =
generateToken(user);



res.json({

success:true,

token,

user:{
id:user._id,
name:user.name,
email:user.email,
role:user.role
}

});



}
catch(error){

res.status(500).json({

success:false,

message:error.message

});

}


};



module.exports={
register,
login
};