const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const salt = bcrypt.genSaltSync(10);

const userSchema = new mongoose.Schema({
    username: {type: String, unique: true},
    email: { type: String, lowercase: true, trim: true, unique: true },
    status: String,
    name: { type: String, lowercase: true, trim: true },
    phone: String,
    company: String,
    streetAddress: String,
    postalCode: String,
    firstName: String,
    lastName: String,
    password: String,
    referral: String,
    params: {},
    brainId: String
});

userSchema.pre('save', function (next) {
  var user = this;

  // only hash password if it's been modified
  if (!user.isModified('password')) return next();

  // hash the password using our new salt
  bcrypt.hash(user.password, salt, function (err, hash) {
    if (err) return next(err);

    // override the cleartext password with the hased
    user.password = hash;
    next();
