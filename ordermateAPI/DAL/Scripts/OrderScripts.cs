namespace ordermateAPI.DAL.Scripts;

public static class OrderScripts
{
    public static string CreateOrder = "INSERT INTO Orders (StoreId, OrderNumber, OrderStatus, Email, TotalValue, Notes, CompletedDate, CreatedDate, LastModifiedDate) VALUES (@storeId, @orderNumber, 0, @email, 0, '', null, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)";
    public static string GetByStoreId = "SELECT * FROM Orders WHERE StoreId = @storeId";
    public static string GetByOrderNumber = "SELECT * FROM Orders WHERE OrderNumber = @orderNumber";
}