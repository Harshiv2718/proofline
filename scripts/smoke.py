"""Exercise HTTP sessions, CSRF origin checking and a real GraphQL workflow."""
import datetime
import http.cookiejar
import json
import sys
import urllib.request
import uuid

base = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8080').rstrip('/')
jar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
with client.open(base + '/api/health/', timeout=15) as response:
    assert response.status == 200
with client.open(base + '/api/session/', timeout=15) as response:
    token = json.load(response)['csrfToken']

def graphql(query, variables=None):
    request = urllib.request.Request(
        base + '/graphql/',
        data=json.dumps({'query': query, 'variables': variables or {}}).encode(),
        headers={'Content-Type': 'application/json', 'X-CSRFToken': token, 'Origin': base},
    )
    with client.open(request, timeout=15) as response:
        body = json.load(response)
    assert not body.get('errors'), body
    return body['data']

payload = {
    'title': 'HTTP smoke ' + str(uuid.uuid4()),
    'date': datetime.date.today().isoformat(),
    'notes': 'ACTION [Maya] Verify the export\nDECISION: Keep source evidence',
}
query = '''mutation($title:String!,$date:Date!,$notes:String!){
  importMeeting(title:$title,meetingDate:$date,notes:$notes){
    duplicate meeting{id suggestions{id kind sourceLine sourceQuote}}
  }
}'''
meeting = graphql(query, payload)['importMeeting']
assert meeting['duplicate'] is False
assert graphql(query, payload)['importMeeting']['duplicate'] is True
action = next(s for s in meeting['meeting']['suggestions'] if s['kind'] == 'ACTION')
assert action['sourceLine'] == 1
review = '''mutation($id:ID!){reviewSuggestion(id:$id,decision:ACCEPT){task{id version status}}}'''
task = graphql(review, {'id': action['id']})['reviewSuggestion']['task']
assert graphql(review, {'id': action['id']})['reviewSuggestion']['task']['id'] == task['id']
update = '''mutation($id:ID!,$version:Int!){
  updateTask(id:$id,expectedVersion:$version,status:DONE){task{id status version}}
}'''
updated = graphql(update, {'id': task['id'], 'version': task['version']})['updateTask']['task']
assert updated['status'] == 'DONE'
print('HTTP smoke passed: session, Origin/CSRF, import, deduplication, review, task update.')
