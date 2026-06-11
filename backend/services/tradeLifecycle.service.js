"use strict";

function activeTradeQuery({ tradeId, userId, marketFilter = {} }) {
  return {
    _id: tradeId,
    user: userId,
    ...marketFilter,
    deletedAt: null,
  };
}

function deletedTradeQuery({ tradeId, userId, marketFilter = {} }) {
  return {
    _id: tradeId,
    user: userId,
    ...marketFilter,
    deletedAt: { $exists: true, $ne: null },
  };
}

async function softDeleteTrade(Model, {
  tradeId,
  userId,
  deletedBy = userId,
  deleteReason = "",
  deletedSource = "user",
  marketFilter = {},
  options = {},
}) {
  const now = new Date();
  return Model.findOneAndUpdate(
    activeTradeQuery({ tradeId, userId, marketFilter }),
    {
      $set: {
        deletedAt: now,
        deletedBy,
        deleteReason,
        deletedSource,
      },
    },
    { returnDocument: "after", ...options }
  );
}

async function restoreTrade(Model, {
  tradeId,
  userId,
  marketFilter = {},
  options = {},
}) {
  return Model.findOneAndUpdate(
    deletedTradeQuery({ tradeId, userId, marketFilter }),
    {
      $set: { deletedAt: null },
      $unset: {
        deletedBy: "",
        deleteReason: "",
        deletedSource: "",
      },
    },
    { returnDocument: "after", ...options }
  );
}

module.exports = {
  activeTradeQuery,
  deletedTradeQuery,
  restoreTrade,
  softDeleteTrade,
};
