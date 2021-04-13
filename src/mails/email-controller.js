let transporter = require("./email-config");

const MAIL_FROM = 'report.calls@company.com';
exports.sendEmail = async (msg) => {
  try {
    const mailOption = {
      from: MAIL_FROM,
      to: msg.to,
      cc: msg.cc,
      bcc: msg.bcc,
      subject: msg.subject,
      text: msg.text,
      html: msg.html
    };

    let info = await transporter.sendMail(mailOption);
    console.log("Email send successfully: ", mailOption);
  } catch (err) {
    console.log(err);
  }

};