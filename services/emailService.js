const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async sendVerificationEmail(email, verificationCode, firstName) {
    // Skip email sending if SMTP is not configured
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('SMTP not configured, skipping email send to:', email);
      console.log('Verification code for', email, ':', verificationCode);
      return true;
    }

    const mailOptions = {
      from: `"Chart Breaker EHR" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Email Verification - Chart Breaker EHR',
      html: this.getVerificationEmailTemplate(firstName, verificationCode)
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log('Verification email sent to:', email);
      return true;
    } catch (error) {
      console.error('Error sending verification email:', error);
      console.log('Verification code for', email, ':', verificationCode);
      return true; // Return true to allow registration to continue
    }
  }

  async sendRegistrationApprovalEmail(email, firstName, adminName, completionToken) {
    // Skip email sending if SMTP is not configured
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('SMTP not configured, skipping approval email to:', email);
      return true;
    }

    const mailOptions = {
      from: `"Chart Breaker EHR" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Registration Approved - Chart Breaker EHR',
      html: this.getApprovalEmailTemplate(firstName, adminName, email, completionToken)
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log('Approval email sent to:', email);
      return true;
    } catch (error) {
      console.error('Error sending approval email:', error);
      return true; // Return true to allow process to continue
    }
  }

  async sendRegistrationRejectionEmail(email, firstName, adminName, reason) {
    // Skip email sending if SMTP is not configured
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('SMTP not configured, skipping rejection email to:', email);
      return true;
    }

    const mailOptions = {
      from: `"Chart Breaker EHR" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Registration Status Update - Chart Breaker EHR',
      html: this.getRejectionEmailTemplate(firstName, adminName, reason)
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log('Rejection email sent to:', email);
      return true;
    } catch (error) {
      console.error('Error sending rejection email:', error);
      return true; // Return true to allow process to continue
    }
  }

  getVerificationEmailTemplate(firstName, verificationCode) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Email Verification</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #1976d2; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .verification-code { 
            background: #1976d2; 
            color: white; 
            padding: 15px; 
            text-align: center; 
            font-size: 24px; 
            font-weight: bold; 
            margin: 20px 0;
            border-radius: 5px;
          }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Chart Breaker EHR</h1>
            <h2>Email Verification Required</h2>
          </div>
          <div class="content">
            <p>Hello ${firstName},</p>
            <p>Thank you for requesting access to Chart Breaker EHR. To complete your registration, please verify your email address using the code below:</p>
            
            <div class="verification-code">
              ${verificationCode}
            </div>
            
            <p>This verification code will expire in 24 hours. If you didn't request this registration, please ignore this email.</p>
            <p>Once your email is verified, your registration will be reviewed by an administrator before you can access the system.</p>
          </div>
          <div class="footer">
            <p>© 2024 Chart Breaker EHR. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getApprovalEmailTemplate(firstName, adminName, email, completionToken) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Registration Approved</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4caf50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .button { 
            background: #1976d2; 
            color: white; 
            padding: 12px 24px; 
            text-decoration: none; 
            border-radius: 5px; 
            display: inline-block;
            margin: 20px 0;
          }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Chart Breaker EHR</h1>
            <h2>Registration Approved!</h2>
          </div>
          <div class="content">
            <p>Hello ${firstName},</p>
            <p>Great news! Your registration request has been approved by ${adminName}.</p>
            <p>You can now complete your account setup and access the Chart Breaker EHR system.</p>
            
            <a href="${process.env.CLIENT_URL}/complete-registration?email=${encodeURIComponent(email || '')}&token=${encodeURIComponent(completionToken || '')}" class="button">
              Complete Registration
            </a>
            
            <p>If you have any questions, please contact your administrator.</p>
          </div>
          <div class="footer">
            <p>© 2024 Chart Breaker EHR. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getRejectionEmailTemplate(firstName, adminName, reason) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Registration Update</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f44336; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .reason { background: #ffebee; padding: 15px; border-left: 4px solid #f44336; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Chart Breaker EHR</h1>
            <h2>Registration Update</h2>
          </div>
          <div class="content">
            <p>Hello ${firstName},</p>
            <p>Thank you for your interest in Chart Breaker EHR. Unfortunately, your registration request has not been approved at this time.</p>
            
            <div class="reason">
              <strong>Reason:</strong> ${reason || 'No specific reason provided'}
            </div>
            
            <p>If you believe this is an error or would like to discuss this further, please contact your administrator.</p>
            <p>You may submit a new registration request in the future if your circumstances change.</p>
          </div>
          <div class="footer">
            <p>© 2024 Chart Breaker EHR. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

module.exports = new EmailService();
