require('dotenv').config();

// Import dependencies
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const morgan = require("morgan"); // ✅ Move this here

// Initialize app
const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan("dev")); // ✅ Now it's safe to use 'app'

const prisma = new PrismaClient();

// Global error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: "Something went wrong!" });
});

// Health check route
app.get("/", (req, res) => {
    res.send("Server is running!");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// User registration (simplified example)
app.post("/users/register", async (req, res) => {
    const { email, name } = req.body;
    try {
        const user = await prisma.user.create({
            data: { email, name }
        });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create escrow transaction
app.post("/escrow/create", async (req, res) => {
    const { buyerId, sellerId, amount, milestones } = req.body;
    try {
        const escrow = await prisma.escrow.create({
            data: {
                buyerId,
                sellerId,
                amount,
                status: "PENDING",
                milestones: { create: milestones },
            }
        });
        res.json(escrow);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fund escrow via Stripe
app.post("/escrow/fund", async (req, res) => {
    const { escrowId, paymentMethodId } = req.body;
    try {
        const escrow = await prisma.escrow.findUnique({ where: { id: escrowId } });
        if (!escrow) return res.status(404).json({ error: "Escrow not found" });
        
        const paymentIntent = await stripe.paymentIntents.create({
            amount: escrow.amount * 100,
            currency: "usd",
            payment_method: paymentMethodId,
            confirm: true,
            capture_method: "manual",
            automatic_payment_methods: {
                enabled: true,
                allow_redirects: "never", // ✅ Prevents Stripe from requiring a return_url
            },
        });
        
        
        await prisma.escrow.update({ where: { id: escrowId }, data: { stripePaymentIntentId: paymentIntent.id } });
        res.json({ success: true, paymentIntentId: paymentIntent.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Release milestone payment
app.post("/escrow/milestone/release", async (req, res) => {
    const { escrowId, milestoneId } = req.body;
    try {
        const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
        if (!milestone || milestone.released) return res.status(400).json({ error: "Invalid milestone" });
        
        const escrow = await prisma.escrow.findUnique({ where: { id: escrowId } });
        if (!escrow) return res.status(404).json({ error: "Escrow not found" });
        
        await stripe.paymentIntents.capture(escrow.stripePaymentIntentId, { amount_to_capture: milestone.amount * 100 });
        
        await prisma.milestone.update({ where: { id: milestoneId }, data: { released: true } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});