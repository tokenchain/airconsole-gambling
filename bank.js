/**
 * Bank - include this in the screen.html
 * @constructor
 */
var Bank = function(airconsole, opts) {
  opts = opts || {};
  this.airconsole = airconsole;
  this.data = {
    devices: {},
    bet_round_id: 0,
    bets_locked: false
  };
  this.tag_quotes = {};
  this.start_value = opts.start_value || 1000;
  this.custom_key = "bank";
  this.sender_id = 0;
  this.round_bets_device_ids = [];
  this.mode = opts.mode || Bank.Mode.Default;
  if (!this.airconsole) {
    throw "You have to pass the airconsole instance to the Gambler constructor!";
  }
};

Bank.Mode = {
  Default: 'default',
  Winner_Takes_All: 'winner_takes_all',
};

/**
 * Initializes the bank. Call this in airconsole.ready()
 */
Bank.prototype.init = function() {
  var devices = this.airconsole.getControllerDeviceIds();
  for (var i = 0; i < devices.length; i++) {
    var device_id = devices[i];
    this.onConnect(device_id);
  }
  this.update();
};

/**
 * Resets the bank and all devices. All bets are gonna to be lost
 */
Bank.prototype.reset = function() {
  this.data = {
    devices: {},
    bet_round_id: 0,
    bets_locked: false
  };
  this.init();
};

/**
 * Adds new gambler to the bank. Call this in airconsole.onConnect()
 * @param {Number} device_id
 */
Bank.prototype.onConnect = function(device_id) {
  if (!this.data.devices[device_id]) {
    this.data.devices[device_id] = {
      device_id: device_id,
      active: true,
      current_amount: this.start_value,
      bets: {},
      transactions: [
        {
          amount: this.start_value,
          sender_id: this.sender_id,
          ts: +(new Date),
          init: true
        }
      ]
    };
  } else {
    this.data.devices[device_id].active = true;
  }
  this.update();
};

/**
 * Flags gambler as inactive. Call this in airconsole.onDisconnect()
 * @param {Number} device_id
 */
Bank.prototype.onDisconnect = function(device_id) {
  this.data.devices[device_id].active = false;
  this.checkAllDevicesPlacedBet();
};

/**
 * Handles incoming bets. Call this in airconsole.onMessage()
 * @param {Number} device_id
 * @param {Object} data
 */
Bank.prototype.onMessage = function(device_id, data) {
  if (data.action === AirConsoleAction.PLACE_BET) {
    this.placeBet(device_id, data);
  }
  if (data.action === AirConsoleAction.MAKE_TRANSACTION) {
    this.makeTransaction(data.opts || {});
  }
};

Bank.prototype.onCustomDeviceStateChange = function(device_id, data) {};

/**
 * Call this to update all devices with the newest data
 */
Bank.prototype.update = function() {
  this.airconsole.setCustomDeviceStateProperty(this.custom_key, this.data);
};

/**
 * Call this before a new round
 */
Bank.prototype.openRound = function() {
  this.round_bets_device_ids = [];
  this.data.bet_round_id++;
  this.data.bets_locked = false;
  this.update();
};

/**
 * Call this to close the round. No more new bets can be made
 */
Bank.prototype.closeRound = function() {
  this.data.bets_locked = true;
  this.update();
};

/**
 * Returns True if the current round is locked
 * @return{Boolean}
 */
Bank.prototype.isLocked = function() {
  return this.data.bets_locked;
};

/**
 * Places a bet for a device
 * @param{Number} device_id
 * @param{Object} data
 */
Bank.prototype.placeBet = function(device_id, data) {
  if (this.data.bets_locked) return;
  var current_amount = this.getCurrentAmountOfDevice(device_id);
  if (current_amount !== undefined && current_amount - data.amount >= 0) {
    var bank = this.getCustomData().devices;
    if (!bank[device_id].bets[this.data.bet_round_id]) {
      bank[device_id].bets[this.data.bet_round_id] = [];
    }
    var bet = {
      round: this.data.bet_round_id,     // 12
      amount: data.amount,          // E.g. 200
      success_tag: data.success_tag // E.g. 'player_1_wins'
    };
    bank[device_id].bets[this.data.bet_round_id].push(bet);
    // Count bets
    if (this.round_bets_device_ids.indexOf(device_id) === -1) {
      this.round_bets_device_ids.push(device_id);
    }
    this.checkAllDevicesPlacedBet();
    this.update();
  }
};

Bank.prototype.onAllGamblersBet = function() {};

/**
 * Evaluates winners and shifts the money according to bet success
 * @param {Array} success_tags - List of events which win
 */
Bank.prototype.evaluateRound = function(success_tags, bet_round_id) {
  if (this.mode === Bank.Mode.Winner_Takes_All) {
    this.evaluateWinnerTakesAll(success_tags, bet_round_id);
  } else {
    this.getResultIDsOfBetRound(success_tags, bet_round_id);
  }
  this.update();
};

Bank.prototype.evaluateWinnerTakesAll = function(success_tags, bet_round_id) {
  var bank_data = this.getCustomData().devices;
  bet_round_id = bet_round_id || this.data.bet_round_id;
  var winners = [];
  var losers = {};
  var total_loser_amount = 0;


  for (var device_id in bank_data) {
    var device_data = bank_data[device_id];
    var current_bets = device_data.bets[bet_round_id];
    if (!current_bets) continue;

    for (var i = 0; i < current_bets.length; i++) {
      var bet = current_bets[i];
      // Win?
      if (success_tags.indexOf(bet.success_tag) !== -1) {
        winners.push(device_id);
      } else {
        // if (!losers[device_id]) {
        //   losers[device_id] = 0;
        // }
        // losers[device_id] = bet.amount;
        this.addTransaction(device_id, -bet.amount, device_id);
        total_loser_amount += bet.amount;
      }
    }
  }

  var total_win = Math.round(total_loser_amount / winners.length);
  for (var i = 0; i < winners.length; i++) {
    var winner_device_id = winners[i];
    this.addTransaction(winner_device_id, total_win, winner_device_id);
  }

};

/**
 * Returns the delta amount for each device of a bet round
 * @param {Array} success_tags - List of events which win
 * @param {String} bet_round_id - The bet round id to evaluate
 * @return {Object}
 */
Bank.prototype.getResultIDsOfBetRound = function(success_tags, bet_round_id) {
  var bank_data = this.getCustomData().devices;
  bet_round_id = bet_round_id || this.data.bet_round_id;
  var devices_balance = {};

  for (var device_id in bank_data) {
    var device_data = bank_data[device_id];
    var current_bets = device_data.bets[bet_round_id];
    if (!current_bets) continue;

    for (var i = 0; i < current_bets.length; i++) {
      var bet = current_bets[i];

      if (!devices_balance[device_id]) {
        devices_balance[device_id] = 0;
      }

      // Has a correct bet
      if (success_tags.indexOf(bet.success_tag) !== -1) {
        var plus_amount = bet.amount;
        var quota = this.tag_quotes[bet.success_tag];
        if (quota) {
          plus_amount *= quota;
        }
        devices_balance[device_id] += plus_amount;
        this.addTransaction(device_id, plus_amount, device_id);
      } else {
        devices_balance[device_id] -= bet.amount;
        this.addTransaction(device_id, -bet.amount, device_id);
      }

    }
  }
  return devices_balance;
};

Bank.prototype.getCurrentAmountOfDevice = function(device_id) {
  var bank = this.getCustomData();
  var amount = 0;
  if (bank && bank.devices[device_id]) {
    var device_data = bank.devices[device_id];
    var transactions = device_data.transactions;
    for (var i = 0; i < transactions.length; i++) {
      var transaction = transactions[i];
      amount += transaction.amount;
    }
  } else {
    amount = undefined;
  }
  return amount;
};

Bank.prototype.makeTransaction = function(opts) {
  var success = false;
  var receiver_id = parseInt(opts.receiver_id, 10);
  var amount = opts.amount;
  var sender_id = parseInt(opts.sender_id, 10);
  var current_amount = this.getCurrentAmountOfDevice(receiver_id);
  if (current_amount !== undefined) {
    var bank = this.getCustomData();
    var device_data = bank[receiver_id];
    if (current_amount - amount > 0) {
      // Another device is transfering coins to a device
      if (sender_id !== receiver_id) {
        if (this.addTransaction(sender_id, -amount, sender_id)) {
          success = this.addTransaction(receiver_id, amount, sender_id);
        }
      } else {
        success = this.addTransaction(receiver_id, -amount, receiver_id);
      }
      this.update();
    }
  } else {
    // TODO: on new player connects
    console.warn("Device is not in the bank registered");
  }
  return success;
};

Bank.prototype.addTransaction = function(device_id, amount, sender_id) {
  var bank_data = this.data.devices;
  var device_data = bank_data[device_id];
  var success = false;
  if (device_data && device_data.current_amount - amount > 0) {
    this.data.devices[device_id].transactions.push({
      amount: amount,
      ts: +(new Date()),
      sender_id: sender_id
    });
    success = true;
    this.data.devices[device_id].current_amount += amount;
  }
  return success;
};

Bank.prototype.getCustomData = function() {
  return this.airconsole.getCustomDeviceState()[this.custom_key];
};

Bank.prototype.setTagQuota = function(tag, quota) {
  this.tag_quotes[tag] = quota || 1;
};

Bank.prototype.getTagQuota = function(tag) {
  return this.tag_quotes[tag];
};

Bank.prototype.hasBetOn = function(success_tags, bet_tags) {
  for (var i = 0; i < success_tags.length; i++) {
    var tag = success_tags[i];
    for (var b = 0; i < bet_tags.length; b++) {
      if (tag === bet_tags[b]) {
        return true;
      }
    }
  }
  return false;
};

Bank.prototype.getActiveDeviceIds = function() {
  var actives = [];
  for (var id in this.data.devices) {
    if (this.data.devices[id].active) {
      actives.push(id);
    }
  }
  return actives;
};

Bank.prototype.checkAllDevicesPlacedBet = function() {
  if (this.round_bets_device_ids.length >= this.getActiveDeviceIds().length) {
    this.onAllGamblersBet();
  }
};
