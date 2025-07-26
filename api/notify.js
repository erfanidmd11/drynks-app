import { createClient } from '@supabase/supabase-js';
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_KEY);

export default async function handler(req, res) {
  const { date_id, actor_id, action } = req.body;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { error } = await supabase.rpc('notify_date_host_on_action', {
    date_id,
    actor_id,
    action
  });

  if (error) return res.status(500).json({ error: error.message });

  const { data: log } = await supabase
    .from('notifications_log')
    .select('recipient_id, message')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const { data: host } = await supabase
    .from('profiles')
    .select('email, push_token, screen_name')
    .eq('id', log.recipient_id)
    .single();

  if (host?.email) {
    await sgMail.send({
      to: host.email,
      from: 'notify@drynks.app',
      subject: 'Someone joined your date 🎉',
      text: log.message,
    });
  }

  // TODO: Push notification can be added here using host.push_token

  return res.status(200).json({ success: true });
}
