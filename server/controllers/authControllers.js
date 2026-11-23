import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { sql } from "../config/db.js";


// Generates JWT access token and attaches it to response as HTTP-Only Cookie
export const sendTokenResponse = (res, userId, statusCode = 200, extraData = {})=>{
    const token = jwt.sign({id: userId}, process.env.JWT_SECRET, {expiresIn: "7d"})

    const isProduction = process.env.NODE_ENV === "production"

    res.cookie("token", token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    })

    res.status(statusCode).json({token, ...extraData})
}

//Register new User
//POST /api/auth/register
export const registerUser = async (req, res, next) => {
    try {
        const {name, email, password} = req.body || {};
        if (
            typeof name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !name.trim() ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({error: "Name, email, and password are required."})
        }
        const normalizedName = name.trim();
        const normalizedEmail = email.toLowerCase().trim();
        if (
            Array.from(normalizedName).length > 255 ||
            Array.from(normalizedEmail).length > 255
        ) {
            return res.status(400).json({error: "Name and email must not exceed 255 characters."})
        }
        if (bcrypt.truncates(password)) {
            return res.status(400).json({error: "Password must not exceed 72 bytes."})
        }

        const [existing] = await sql`SELECT id FROM users WHERE email = ${normalizedEmail}`

        if(existing){
            return res.status(400).json({error: "User with this email already exists."})
        }

        const salt = await bcrypt.genSalt(10)
        const hashedPassword = await bcrypt.hash(password, salt);


        const storageLimit = Number(process.env.MAX_STORAGE_PER_USER || 1073741824);

        const [user] = await sql`INSERT INTO users (name, email, password, storage_limit)
        VALUES (${normalizedName}, ${normalizedEmail}, ${hashedPassword}, ${storageLimit})
        ON CONFLICT (email) DO NOTHING
        RETURNING id, name, email, storage_used, storage_limit, created_at, updated_at`;

        if (!user) {
            return res.status(400).json({error: "User with this email already exists."})
        }

        return sendTokenResponse(res, user.id, 201, {user});
    } catch (error) {
        return next(error);
    }
}

//Login User
//POST /api/auth/login
export const LoginUser = async (req, res, next) => {
try {
        const { email, password} = req.body || {};
        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({error: "Email and Password are required."})
        }
        const normalizedEmail = email.toLowerCase().trim();
        if (Array.from(normalizedEmail).length > 255) {
            return res.status(400).json({error: "Email must not exceed 255 characters."})
        }
        if (bcrypt.truncates(password)) {
            return res.status(400).json({error: "Password must not exceed 72 bytes."})
        }

        const [user] = await sql`SELECT id, name, email, password, storage_used, storage_limit, created_at, updated_at FROM users WHERE email = ${normalizedEmail}`

        if(!user){
            return res.status(401).json({error: "Invalid email Or Password."})
        }

        const isMatch = await bcrypt.compare(password, user.password)
        if(!isMatch){
            return res.status(401).json({error: "Invalid email Or Password."})
        }

        delete user.password;

        return sendTokenResponse(res, user.id, 200, {user});
    } catch (error) {
        return next(error);
    }
}

//Logout user & clear cookie
// POST /api/auth/logout
export const LogoutUser = async (_req, res, next) => {
    try {
        const isProduction = process.env.NODE_ENV === "production";
        res.clearCookie("token", {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? "none" : "lax",
        })
        
        return res.status(200).json({message: "Logged out successfully."})
    } catch (error) {
        return next(error);
    }
}

// Get current user profile & storage info
// GET /api/auth/me
export const getMe = async (req, res, next) => {
    try {
        // req.user is already loaded by protect middleware
        return res.status(200).json({user: req.user})
    } catch (error) {
        return next(error);
    }
}