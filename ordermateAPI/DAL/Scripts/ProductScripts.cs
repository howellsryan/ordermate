namespace ordermateAPI.DAL.Scripts;

public static class ProductScripts
{
    public static string GetById = "SELECT * FROM Products WHERE ProductId = @id";
    public static string Get = "SELECT * FROM Products";
    public static string GetByCategoryId = "SELECT * FROM Products WHERE CategoryId = @categoryId";
}