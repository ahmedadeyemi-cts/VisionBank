(() => {
  "use strict";
  const guides = {
  "webex": [
    "Webex Dashboard",
    [
      [
        "Who is waiting, and who is being helped?",
        "Current Queue Status shows the lines of customers waiting for help. Waiting means a customer has not reached an agent yet. Active means someone is being helped. Wrap-up means the agent is finishing notes or other work after a contact. Voice calls and chats have separate totals. The page updates automatically; check any message about delayed data."
      ],
      [
        "See the whole day or the current login",
        "Choose Today (Central) to include the agent’s reported work for the day, even if they logged out and back in. Choose Current session for work from the current login. The voice and chat tables each have their own selector. One exception: chat handled/completed totals always cover the day and count toward the last agent who helped with the chat."
      ],
      [
        "Show only agents who are logged in",
        "Hide logged-out agents is on by default. Turn it off to see agents who worked earlier but have signed out. Changing it updates both performance tables and is remembered in your browser. Agents on Lunch, on a call, or finishing work still appear if they are logged in. Hiding someone never deletes their work. If the system cannot confirm who is logged in, it temporarily shows the full list."
      ],
      [
        "Understand start times and missing numbers",
        "Session Start and Reporting Start choose which start time appears in the table; they do not change the totals. Today uses Central time. Not reported means the system cannot provide a reliable number; it does not mean zero. For a login that crosses midnight, some daily totals may be unavailable because the system cannot separate the work into two days."
      ],
      [
        "Review trends and individual contacts",
        "The analytics tabs show how busy the team is and compare hours, days, weeks, or months. Answered calls reached an agent; abandoned calls ended before an agent answered. Use search and filters to find records, Previous and Next to move through them, and Export to download a spreadsheet-friendly file. Follow-up labels help you find callers who may still need help."
      ],
      [
        "Arrange a callback",
        "A callback is an outgoing call to someone who left before being helped. In Abandoned Callback Settings, choose which calls qualify and when callbacks are allowed. Select calls and review the preview before scheduling. Save plan — no calls only saves your choices; it does not place a call. Callback Workspace shows plans and requests. Turning callbacks off does not cancel calls already scheduled or end calls in progress."
      ],
      [
        "Customize the dashboard and notifications",
        "Dashboard Settings chooses which queues appear and controls agent reminders and what happens after a missed call or chat. Alert Settings controls sounds, spoken alerts, popup messages, and how long to wait between alerts. Test Alert Audio lets you check the sound. Wallboard mode fills the screen for a shared display. Alert History lists alerts. Webex Agent opens signout settings. Dark mode changes the screen colors."
      ]
    ]
  ],
  "index": [
    "Contact Center Dashboard",
    [
      [
        "See how busy the team is",
        "Current Queue Status shows customers waiting for help and the work in progress. Realtime Global Statistics gives an overall view. Check the labels and update messages to see what period each number covers."
      ],
      [
        "Review agent activity",
        "Agent Performance shows each agent’s state and work. Session Start and Reporting Start choose which start time appears. A total for the current login may restart when someone signs out and back in, so it may not represent the whole day."
      ],
      [
        "Set up alerts and a shared display",
        "Alert Settings controls sounds, spoken alerts, popup messages, volume, and how long to wait between alerts. You can also display a message to the team. Test Alert Audio checks the sound. Wallboard mode fills the screen for a shared display. Alert History lists alerts; Clear history removes that list."
      ],
      [
        "Move between pages",
        "Use the navigation links to open other tools. Dark mode changes the screen colors. Some pages and buttons are only available to people with the required permission."
      ]
    ]
  ],
  "agents": [
    "Agent Controls",
    [
      [
        "See who is signed in",
        "Refresh Logged-In Agents updates the list of agents currently signed in. Review this list before using signout settings."
      ],
      [
        "Remind agents to sign out",
        "Turn reminders on, choose the reminder time in Central time, and add any people who should receive a copy under CC Recipients. Save Settings keeps your changes. Send Test Reminder sends a test message."
      ],
      [
        "Sign agents out automatically",
        "Choose the weekday and Saturday signout times, then select all agents or one person. Dry Run means test only: nobody is signed out. With Dry Run disabled and automatic logout enabled, the system can sign agents out. Check the names and times before saving."
      ]
    ]
  ],
  "webex-agent": [
    "Webex Agent Controls",
    [
      [
        "See who is signed in to Webex",
        "Refresh Logged-In Agents updates the list. Check the agent names and states before signing anyone out."
      ],
      [
        "Set an automatic signout time",
        "Turn automatic signout on, set weekday and Saturday times in Central time, choose all logged-in agents or one person, and select a signout reason. Save Settings keeps your changes. Dry Run means test only: nobody is signed out. With Dry Run disabled, the action can sign agents out."
      ],
      [
        "Run signout now or check past results",
        "Run Auto-Signout Now starts the action immediately using your selected settings. Check who it applies to and whether Dry Run is enabled first. Refresh History updates the list of past signout results."
      ],
      [
        "Understand reminder settings",
        "Read Reminder Info before using the reminder fields. These fields support the notification service; saving them is not proof that a reminder was sent."
      ]
    ]
  ],
  "voicemails": [
    "Voicemail Reports",
    [
      [
        "Find voicemail records",
        "Choose a date range, then click Run Report. The summary shows totals, the chart shows activity by date, and Voicemail Details lists the records. Incoming Call Details shows more information about a selected call."
      ],
      [
        "Download, print, or email",
        "Export CSV downloads a file you can open in a spreadsheet. Print / Save PDF opens the print options. Send Daily Email sends a report, so check the report and recipients first."
      ],
      [
        "Have reports sent automatically",
        "Schedule Report lets you choose who gets a report, how often, which dates it covers, and the send time in Central time. Choose PDF for a document or CSV for a spreadsheet. Monthly rules choose the day of the month. Save Schedule keeps your choices; Add New Schedule adds another delivery. Send Test Report sends a test email."
      ]
    ]
  ],
  "fax": [
    "Fax Reports",
    [
      [
        "Find fax records",
        "Choose a date range, then click Run Report. The summary shows totals, the chart shows activity by date, and Fax Details lists the records. Fax CDR Details shows more information about a selected fax; CDR means call detail record."
      ],
      [
        "Download, print, or email",
        "Export CSV downloads a file you can open in a spreadsheet. Print / Save PDF opens the print options. Send Email sends the report, so check the report and recipients first."
      ],
      [
        "Have reports sent automatically",
        "Schedule Report lets you choose who gets a report, how often, which dates it covers, and the send time in Central time. Choose PDF for a document or CSV for a spreadsheet. Monthly rules choose the send date. Save Schedule keeps your choices; Add New Schedule adds another delivery. Send Test Report sends a test email."
      ]
    ]
  ],
  "directory": [
    "Directory Management",
    [
      [
        "Add or change a contact",
        "Add Contact creates a new entry. Use the controls beside a contact to edit or remove it. Review the changes, then click Save Directory to make them available in the phone directory."
      ],
      [
        "Bring in a contact list or download a copy",
        "Bulk Upload CSV brings in contacts from a spreadsheet-style file. Review the contacts before saving. Download CSV gives you a copy for a spreadsheet. Download XML gives you the format used by the Yealink phone directory."
      ],
      [
        "Change appearance or sign out",
        "Dark mode changes the screen colors. Logout signs you out. You need the appropriate permission to edit and save the directory."
      ]
    ]
  ],
  "device": [
    "Device & Extension Manager",
    [
      [
        "Find the phone you need",
        "Search for a phone or narrow the list by location, owner, or connection status. Clear filters shows the full list again. Refresh updates the information. Webex and Phonism are separate services, so their connection statuses may differ."
      ],
      [
        "Identify who is making the change",
        "Identify Operator records your name and work email. You may need to enter a code sent to your email. Authorized administrators use Admin Settings to manage this verification step."
      ],
      [
        "Put a temporary extension on a phone",
        "Open a phone, choose the temporary Line 2 extension and how long it should stay, and optionally enter a reason. Review Change lets you check the request. Save & Sync applies it and starts the phone update, which can restart the phone. The system checks the result and restores the original setup when the time ends. Read the status before using the phone."
      ],
      [
        "Check changes and connection problems",
        "Change History lists phone updates. Integration Health shows whether the connected services are working. Reboot & Reverify restarts a phone and checks it again; this can interrupt someone using that phone."
      ],
      [
        "Set up the phone’s self-service button",
        "Phone Self-Service Setup creates or removes the setup for Button 7 on a phone. Fleet Keys contains codes and setup links used to connect phones to this service. Generate New Fleet Key changes that setup code. These are phone-administration controls; ask your phone administrator if you are unsure which setup to use."
      ]
    ]
  ],
  "security": [
    "Security & Access Control",
    [
      [
        "Manage people and permissions",
        "Overview summarizes the security setup. Identity & Access manages user accounts, what each person may do, and MFA — the extra verification code used at sign-in. Administrative Sessions shows administrator sign-ins. The permission matrix explains which roles can use which tools. Logout signs you out."
      ],
      [
        "Choose where and when access is allowed",
        "Network Access sets which internet addresses may connect. An IP address identifies a connection; a CIDR range is a group of addresses. Access Policy sets allowed hours in Central time. Check changes carefully before saving because they may prevent people from signing in."
      ],
      [
        "Review activity or test an address",
        "Audit & Monitoring lists security events and settings changes. Search and filters help you find allowed or denied access attempts. The IP and CIDR testers check whether an address matches the rules. Running a test does not change the rules."
      ],
      [
        "Check the system license",
        "Licensing shows whether this installation has a valid license to run. Check License Now and Full Revalidation check its current status. Activation applies a license key; Deactivate Local License removes the local activation. Authority Settings chooses where license checks are sent. These settings are for the administrator responsible for licensing."
      ],
      [
        "Manage phone-change permissions",
        "Device Management controls who can administer phone changes and how long a person’s identity verification stays valid. Fleet keys are setup codes used to connect phones to the service. Changes here affect Device & Extension Manager."
      ]
    ]
  ]
};
  const page = (location.pathname.split('/').pop() || 'index').replace(/\.html$/i, '').toLowerCase();
  const guide = guides[page === 'dashboard' ? 'index' : page];
  if (!guide || document.getElementById('vb-page-help')) return;
  const header = document.querySelector('header');
  if (!header) return;
  const host = header.querySelector('.enterprise-header-tools, .header-actions, .device-header-actions, .vb-header-actions, .header-right') || header;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'vb-help-trigger';
  button.textContent = '?';
  button.title = 'Help with this page';
  button.setAttribute('aria-label', 'Help with ' + guide[0]);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'vb-page-help');
  const dialog = document.createElement('dialog');
  dialog.id = 'vb-page-help';
  dialog.className = 'vb-help-dialog';
  dialog.setAttribute('aria-labelledby', 'vb-page-help-title');
  const top = document.createElement('div');
  top.className = 'vb-help-heading';
  const title = document.createElement('h2');
  title.id = 'vb-page-help-title';
  title.textContent = guide[0] + ' — Help';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'vb-help-close';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close page help');
  top.append(title, close);
  const content = document.createElement('div');
  content.className = 'vb-help-content';
  const intro = document.createElement('p');
  intro.textContent = 'Start with the topic you need below. This guide explains what the buttons do. Some options may only appear if you have permission to use them.';
  content.append(intro);
  for (const [heading, description] of guide[1]) {
    const section = document.createElement('section');
    const h = document.createElement('h3');
    h.textContent = heading;
    const p = document.createElement('p');
    p.textContent = description;
    section.append(h, p);
    content.append(section);
  }
  dialog.append(top, content);
  document.body.append(dialog);
  host.append(button);
  button.addEventListener('click', () => { if (!dialog.open) dialog.showModal(); });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => button.focus());
})();
