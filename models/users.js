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
    params: {}
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
  });
});

userSchema.methods.hashPassword = function(password, next) {
  bcrypt.hash(password, salt, function (err, hash) {
    if (err) return next(err);
    next(hash);
  });
};

userSchema.methods.comparePassword = function (candidatePassword, callback) {
  bcrypt.compare(candidatePassword, this.password, function (err, isMatch) {
    if (err) return callback(err);
    callback(undefined, isMatch);
  });
};

// set up a mongoose model and pass it using module.exports
module.exports = mongoose.model('user', userSchema);
