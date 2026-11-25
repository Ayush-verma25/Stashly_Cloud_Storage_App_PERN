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

    res.status(statusCode).json(extraData)
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
        if (normalizedName.includes("\0")) {
            return res.status(400).json({error: "Name must not contain NUL characters."})
        }
        if (
            Array.from(normalizedName).length > 255 ||
            Array.from(normalizedEmail).length > 255
        ) {
            return res.status(400).json({error: "Name and email must not exceed 255 characters."})
        }
        if (bcrypt.truncates(password)) {
            return res.status(400).json({error: "Password must not exceed 72 bytes."})
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const [existing] = await sql`SELECT id FROM users WHERE email = ${normalizedEmail}`

        if(existing){
            return res.status(200).json({message: "Registration request processed. Please log in with your credentials."})
        }

        const storageLimit = Number(process.env.MAX_STORAGE_PER_USER || 1073741824);

        await sql`INSERT INTO users (name, email, password, storage_limit)
        VALUES (${normalizedName}, ${normalizedEmail}, ${hashedPassword}, ${storageLimit})
        ON CONFLICT (email) DO NOTHING`;

        // A concurrent request may have created the account. Never authenticate
        // registration requests or expose the inserted account in the response.
        return res.status(200).json({message: "Registration request processed. Please log in with your credentials."});
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
        // Older registrations accepted passwords longer than bcrypt's 72 byte limit.
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
export const LogoutUser = async (req, res, next) => {
    try {
        const origin = req.get("Origin");
        const allowedOrigins = (process.env.ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
        if (!origin || origin === "null" || !allowedOrigins.includes(origin)) {
            return res.status(403).json({error: "Forbidden origin."});
        }
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