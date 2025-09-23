export default function handler(_req, res) {
  res.status(200).json({
    has_SENDGRID_API_KEY: !!process.env.SENDGRID_API_KEY,
    has_FROM_EMAIL: !!process.env.FROM_EMAIL,
    has_TEAM_EMAIL: !!process.env.TEAM_EMAIL,
  });
}
