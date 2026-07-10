"use strict";

const Notification = require("../../models/Notification");
const Payment = require("../../models/Payment");

describe("sensitive model field constraints", () => {
  test("notification text fields have bounded lengths", () => {
    expect(Notification.schema.path("title").options.maxlength).toBe(120);
    expect(Notification.schema.path("message").options.maxlength).toBe(2000);
  });

  test("Razorpay signatures are excluded from default projections", () => {
    expect(Payment.schema.path("razorpaySignature").options.select).toBe(false);
  });
});
