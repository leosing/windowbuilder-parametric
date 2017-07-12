# windowbuilder-parametric
Микросервис параметрических заказов для [windowbuilder](https://github.com/oknosoft/windowbuilder) предоставляет HTTP API для:

- Создания заказов в сервисе _Заказ дилера_
- Получения информации о составе и статусе сформированных заказов

## HTTP API
Микросервис обрабатывает следующие http запросы:

### POST /prm/doc.calc_order/:ref
Например `post https://crystallit.oknosoft.ru/prm/doc.calc_order/54429bcc-475a-11e7-956f-9cb654bba81d`
- Если заказа с guid `54429bcc-475a-11e7-956f-9cb654bba81d` не существует, будет создан новый заказ и его табличная часть будет заполнена строками, сформированными на основании тела post-запроса
- Если заказ с guid запроса существует, но изделия этого заказа еще не включены в задание на производство, заказ будет перезаполнен
- Если заказ с guid запроса существует и уже запущен в работу, заказ перезаполнен не будет

В теле запроса необходимо передать следующую структуру:
- `ref` - строка(36) - дублирует guid заказа из url запроса. Идентификаторы клиент генерирует самостоятельно. В случае интегарции с 1С, проще всего, в качестве guid заказов использовать ссылки _Заказов поставщику_ - тогда заказы в сервисе и заказы в учетной системе окажутся сопоставленными один к одному
- `number_doc` - строка(11) - номер документа в учетной системе клиента - вспомогательные данные, не участвуют в расчетах
- `date` - строка даты документа в формате ISO - вспомогательные данные, не участвуют в расчетах
- `delivery_date` - строка желаемой даты доставки в формате ISO - вспомогательные данные, могут использоватья при планировании производства
- `partner` - строка(36) - guid контрагента - имеет смысл, если у клиента есть несколько договоров с производителем от разных юрлиц. Если заказы всегда делаются от одного юрлица, поле можно не заполнять
- `production` - массив объектов - табличная часть заказа
  + `nom` - строка(36) - guid вставки, если заказывается продукция (подоконники, откосы, москитки, стеклопакеты) или guid номенклатуры, если заказывается товар (заглушки и прочие штучные комплектующие)
  + `clr` - строка(36) - guid цвета - для материалов можно не указывать
  + `len` - число - длина изделия
  + `height` - число - ширина или высота изделия
  + `quantity` - число - количество заказываемых изделий или единиц товара 
  + `note` - строка - произвольная дополнителная информация о строке заказа (штрихкод, маркировка, индивидуальные даты и т.д.)
  
Если при обработке запроса произошли ошибки, сервис вернёт http статус, отличный от 200 и описание ошибки в теле ответа

В штатном режиме при отсутствии ошибок авторизации и обработки, сервис вернёт http статус 200, а в теле ответа разместит структуру сформированного заказа с ценами:
- `ref` - строка(36) - guid заказа
- `class_name` - строка - имя типа класса данных _doc.calc_order_
- `date` - строка даты документа в формате ISO
- `number_doc` - строка(11) - номер документа
- `organization` - строка(36) - guid организации производителя
- `department` - строка(36) - guid подразделения производителя
- `partner` - строка(36) - guid контрагента
- `contract` - строка(36) - guid договора
- `vat_consider` - булево - признак _учитывать ндс_
- `vat_included` - булево - признак _сумма включает ндс_
- `manager` - строка(36) - guid пользователя, ассоциированного с учетной записью клиента
- `obj_delivery_state` - строка - статус заказа
- `doc_amount` - число - сумма документа в валюте договора
- `amount_operation` - число - сумма документа в валюте упр. учета
- `production` - массив объектов - табличная часть заказа
  + `row` - число - номер строки табчасти
  + `nom` - строка(36) - guid номенклатуры
  + `clr` - строка(36) - guid цвета
  + `len` - число - длина изделия
  + `width` - число - ширина или высота изделия
  + `s` - число - площадь изделия
  + `qty` - число - количество штук товара или продукции
  + `quantity` - число - количество в единицах хранения остатков (продукция всегда числится в шиуках)
  + `price` - число - цена
  + `amount` - число - сумма
  + `vat_rate` - строка - ставка ндс
  + `vat_amount` - число - сумма ндс
  + `note` - строка - произвольная дополнителная информация о строке заказа 
  
### GET /prm/doc.calc_order/:ref
Например `get https://crystallit.oknosoft.ru/prm/doc.calc_order/54429bcc-475a-11e7-956f-9cb654bba81d`
- Если заказа с guid `54429bcc-475a-11e7-956f-9cb654bba81d` не существует, сервис вернёт http статус 404 и описание ошибки
- Если заказ найден и нет проблем с авторизацией, сервис вернёт структуру заказа, аналогичную возвращаемой методом POST

### GET /prm/cat
Например `get https://crystallit.oknosoft.ru/prm/cat`, вернёт объект с данными следующих справочников:
- `clrs` - цвета
- `inserts` - вставки
- `nom` - номенклатура
- `partners` - контрагенты
- `users` - пользователи

Эту информацию можно использовать для настройки таблиц соответствия справочников учетной системы клиента данным производителя
