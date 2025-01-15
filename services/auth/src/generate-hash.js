const bcrypt = require('bcrypt');

const password = 'admin';
bcrypt.hash(password, 10).then(hash => {
  console.log('Password hash for "admin":', hash);
});
