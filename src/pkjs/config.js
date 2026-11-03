// Clay settings page. Values are stored on the phone only (see index.js) and
// are never sent to the watch.

// Clay's stylesheet resets list styling, so number the steps explicitly.
function step(n, html) {
  return '<div style="display:flex;margin-bottom:0.4em">' +
    '<b style="flex:0 0 1.4em;color:#ff4700">' + n + '.</b><span>' + html + '</span></div>';
}

module.exports = [
  {
    type: 'heading',
    defaultValue: 'CarGlance for Hyundai, Kia &amp; Genesis'
  },
  {
    type: 'text',
    defaultValue: 'Shows lock state, charging state and battery level of your car ' +
      'using the Pleos Vehicle Data API.'
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'How to get your credentials',
        size: 5
      },
      {
        type: 'text',
        defaultValue:
          step(1, 'Sign up at the Hyundai/Kia Developer Portal <a href="https://developers.pleos.ai">Pleos Playground</a> (developers.pleos.ai) and sign in.') +
          step(2, 'Open <b>Workspace &rsaquo; My Vehicle Data API</b>. This menu is currently only shown to users in Europe.') +
          step(3, 'Select the tab of your vehicle manufacturer (Hyundai, Kia or Genesis).') +
          step(4, 'Accept the Terms and Conditions and the Privacy Policy.') +
          step(5, 'Click <b>Get API Key</b> and sign in with your manufacturer account (e.g. Hyundai Bluelink) in the pop-up.') +
          step(6, 'Copy the <b>Client ID</b> and <b>Client Secret</b> shown on screen and paste them below.') +
          '<p style="margin-top:0.8em">Only vehicles registered at the time the key was issued are available. ' +
          'For a newly added vehicle, revoke the key and issue a new one. ' +
          '<a href="https://document.pleos.ai/en/api-reference/vehicle-data-api/getting-started/for-private-users/request-my-vehicle-api-key">Full guide</a></p>'
      }
    ]
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'API credentials',
        size: 5
      },
      {
        type: 'select',
        messageKey: 'brand',
        label: 'Manufacturer',
        defaultValue: 'hyundai',
        options: [
          { label: 'Hyundai', value: 'hyundai' },
          { label: 'Kia', value: 'kia' },
          { label: 'Genesis', value: 'genesis' }
        ]
      },
      {
        type: 'input',
        messageKey: 'clientId',
        label: 'Client ID',
        defaultValue: '',
        attributes: { placeholder: 'Client ID', autocapitalize: 'off', autocorrect: 'off' }
      },
      {
        type: 'input',
        messageKey: 'clientSecret',
        label: 'Client Secret',
        defaultValue: '',
        attributes: { placeholder: 'Client Secret', type: 'password' }
      },
      {
        type: 'input',
        messageKey: 'vin',
        label: 'VIN (optional)',
        description: 'Leave empty to use the first vehicle on your account.',
        defaultValue: '',
        attributes: { placeholder: 'e.g. KMHxxxxxxxxxxxxxx', autocapitalize: 'characters' }
      },
      {
        type: 'text',
        defaultValue: '<small>Your credentials are stored on your phone only and are used ' +
          'solely to call api.pleos.ai. Enter <b>demo</b> as Client ID to see sample data.</small>'
      }
    ]
  },
  {
    type: 'submit',
    defaultValue: 'Save'
  }
];
