const nodemailer = require("nodemailer");

let transporter = nodemailer.createTransport({
  pool: true,
  host: "mailhost.emea.svc.intranet.net",
  port: 25,
  secure: false, // true for 465, false for other ports
});

module.exports = transporter;