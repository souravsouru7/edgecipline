"use strict";

// A plan added to PLAN_CONFIG but missing from the Payment model's enum gets
// captured by Razorpay and then rejected by Mongoose — the customer pays and
// is never activated. That is exactly how the 6-month tier shipped broken, so
// this guards the two lists against drifting apart again.

const { PLAN_CONFIG } = require("../../services/paymentService");
const Payment = require("../../models/Payment");
const User = require("../../models/Users");

const paymentPlanEnum = Payment.schema.path("planType").enumValues;
const userPlanEnum = User.schema.path("subscriptionPlan").enumValues;

describe("Payment.planType covers every configured plan", () => {
  test.each(Object.keys(PLAN_CONFIG))("%s is a valid Payment.planType", (planType) => {
    expect(paymentPlanEnum).toContain(planType);
  });

  test("every orderable plan can be persisted", () => {
    const orderable = Object.entries(PLAN_CONFIG)
      .filter(([, plan]) => plan.orderable)
      .map(([planType]) => planType);
    expect(orderable.length).toBeGreaterThan(0);
    for (const planType of orderable) {
      expect(paymentPlanEnum).toContain(planType);
    }
  });

  test("a Payment document validates for each orderable plan", async () => {
    const orderable = Object.entries(PLAN_CONFIG).filter(([, p]) => p.orderable);
    for (const [planType, plan] of orderable) {
      const doc = new Payment({
        user: "507f1f77bcf86cd799439011",
        amount: plan.amount,
        currency: "INR",
        status: "completed",
        paymentMethod: "razorpay",
        transactionId: `txn_${planType}`,
        planType,
        subscriptionDays: plan.days,
      });
      await expect(doc.validate()).resolves.toBeUndefined();
    }
  });
});

describe("User.subscriptionPlan covers every plan label", () => {
  test.each(Object.entries(PLAN_CONFIG).filter(([, p]) => p.userPlan))(
    "%s maps to a valid subscriptionPlan",
    (_planType, plan) => {
      expect(userPlanEnum).toContain(plan.userPlan);
    }
  );
});
