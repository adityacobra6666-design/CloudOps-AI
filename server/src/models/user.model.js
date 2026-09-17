const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },

        password: {
            type: String,
            required: true
        },

        role: {
            type: String,
            enum: [
                "ADMIN",
                "ENGINEER",
                "VIEWER"
            ],
            default: "VIEWER"
        },

        passwordResetTokenHash: {
            type: String,
            default: null
        },

        passwordResetExpiresAt: {
            type: Date,
            default: null
        },

        lastLoginAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

// Custom serializer to strip sensitive fields from API responses
userSchema.set("toJSON", {
    transform: (doc, ret) => {
        delete ret.password;
        delete ret.emailVerificationTokenHash;
        delete ret.passwordResetTokenHash;
        delete ret.__v;
        ret.id = ret._id;
        return ret;
    }
});

module.exports = mongoose.model("User", userSchema);