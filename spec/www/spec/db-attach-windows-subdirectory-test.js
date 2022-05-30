/* 'use strict'; */

var MYTIMEOUT = 20000;

var isWindows = /Windows /.test(navigator.userAgent); // Windows
var isAndroid = !isWindows && /Android/.test(navigator.userAgent);

var pluginScenarioList = [
  isAndroid ? 'Plugin-implementation-default' : 'Plugin',
  'Plugin-implementation-2'
];

var pluginScenarioCount = 1;

var mytests = function() {

  for (var i=0; i<pluginScenarioCount; ++i) {

    describe(pluginScenarioList[i] + ': Windows subdirectory ATTACH / DETACH db test(s)', function() {
      var scenarioName = pluginScenarioList[i];
      var suiteName = scenarioName + ': ';

      it(suiteName + 'preliminary preparation: create multi-level subdirectories',
        function(done) {
          expect(true).toBe(true);
          Windows.Storage.ApplicationData.current.localFolder.createFolderAsync('user-databases').then(function(subdir1) {
            subdir1.createFolderAsync('main').then(function(_ignored) {
              subdir1.createFolderAsync('ext').then(done);
            });
          });
        }, MYTIMEOUT);

      // XXX TODO does not seem to work here:
      xit(suiteName + 'preliminary cleanup 1',
        function(done) {
          expect(true).toBe(true);
          window.sqlitePlugin.deleteDatabase({ name: 'user-databases/ext/attach-external-test.db', location: 'default' }, done, done);
        }, MYTIMEOUT);

      // XXX TODO does not seem to work here:
      xit(suiteName + 'preliminary cleanup 2',
        function(done) {
          expect(true).toBe(true);
          window.sqlitePlugin.deleteDatabase({ name: 'user-databases/main/attach-test.db', location: 'default' }, done, done);
        }, MYTIMEOUT);

      // test with multi-level subdirectories to help match & support a customer scenario
      it(suiteName + 'ATTACH/PRAGMA database_list/DETACH test in multi-level subdirectories',
        function(done) {
          window.sqlitePlugin.openDatabase({
            name: 'user-databases/ext/attach-external-test.db',
            location: 'default'
          }, function(db1) {
          db1.transaction(function(tx) {
            tx.executeSql('DROP TABLE IF EXISTS tt');
            tx.executeSql('CREATE TABLE tt (tv TEXT)');
            tx.executeSql('INSERT INTO tt VALUES (?)', ['test']);
          }, function(err) {
            expect(false).toBe(true);
            done();
          }, function() {

            db1.close(function() {

              window.sqlitePlugin.openDatabase({
                name: 'user-databases/main/attach-test.db',
                location: 'default',
              }, function(db2) {
                db2.attach({ name: 'user-databases/ext/attach-external-test.db', location: 'default', as: 'ext', }, function() {
                  db2.executeSql('SELECT * from ext.tt', [], function(res) {
                    expect(res).toBeDefined();
                    expect(res.rows).toBeDefined();
                    expect(res.rows.length).toBe(1);
                    expect(res.rows.item(0).tv).toBeDefined();
                    expect(res.rows.item(0).tv).toBe('test');

                    db2.executeSql('PRAGMA database_list', [], function(res) {
                      expect(res.rows.length).toBe(2);
                      expect(res.rows.item(0).name).toBe('main');
                      expect(res.rows.item(1).name).toBe('ext');
                      expect(res.rows.item(1).file).toBeDefined();
                      expect(res.rows.item(1).file.indexOf('attach-external-test.db') >= 0).toBe(true);

                      db2.detach('ext', function() {
                        db2.executeSql('PRAGMA database_list', [], function(res) {
                          expect(res.rows.length).toBe(1);
                          expect(res.rows.item(0).name).toBe('main');

                          done();
                        }, function(err) {
                          expect(false).toBe(true);
                          expect(JSON.stringify(err)).toBe('');
                          done();
                        });
                      }, function(err) {
                        expect(false).toBe(true);
                        expect(JSON.stringify(err)).toBe('');
                        done();
                      });
                    }, function(err) {
                      expect(false).toBe(true);
                      expect(JSON.stringify(err)).toBe('');
                      done();
                    });
                  }, function(err) {
                    expect(false).toBe(true);
                    expect(JSON.stringify(err)).toBe('');
                    done();
                  });
                }, function(err) {
                  expect(false).toBe(true);
                  expect(err.message).toBe('--');
                  done();
                });
              });
            });
          });
          });

        }, MYTIMEOUT);

    });

  }

}

if (window.hasBrowser) mytests();
else exports.defineAutoTests = mytests;

/* vim: set expandtab : */
